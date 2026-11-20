"""Install a verified WDA artifact under a persistent per-device coordinator drain."""

import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid


class RenewalError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise RenewalError(code)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def private_json(filename):
    filename = Path(filename)
    require(not filename.is_symlink() and filename.is_file() and
            filename.stat().st_mode & 0o077 == 0 and filename.stat().st_size < 2 * 1024 * 1024,
            'private_file_required')
    return json.loads(filename.read_text())


def save_json(filename, value):
    filename = Path(filename)
    filename.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not filename.parent.is_symlink() and filename.parent.stat().st_mode & 0o077 == 0,
            'private_directory_required')
    temporary = filename.with_name(filename.name + '.' + str(uuid.uuid4()) + '.tmp')
    with temporary.open('x') as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump(value, output)
        output.flush()
        os.fsync(output.fileno())
    temporary.replace(filename)
    directory = os.open(filename.parent, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def date(value):
    require(isinstance(value, str), 'invalid_timestamp')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(parsed.tzinfo is not None, 'invalid_timestamp')
    return parsed.astimezone(dt.timezone.utc)


def artifact_identity(manifest):
    return digest({'archiveSha256': manifest['archiveSha256'], 'bundleId': manifest['bundleId'],
                   'profileUUID': manifest['profileUUID'], 'expiresAt': date(manifest['expiresAt']).isoformat(),
                   'sourceSHA': manifest['sourceSHA'], 'deviceUDIDs': sorted(manifest['deviceUDIDs'])})


def helper_module():
    spec = importlib.util.spec_from_file_location('wda_install_helper', Path(__file__).with_name('install-helper.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_artifact(manifest, target, minimum_hours):
    require(manifest.get('version') == 1 and manifest.get('bundleId') == target['bundleId'] and
            target['serial'] in manifest.get('deviceUDIDs', []) and
            re.fullmatch(r'[a-f0-9]{64}', manifest.get('archiveSha256', '')) and
            re.fullmatch(r'[a-f0-9]{40}', manifest.get('sourceSHA', '')) and
            helper_module().valid_uuid(manifest.get('profileUUID')), 'artifact_manifest_invalid')
    archive = Path(manifest['archivePath'])
    require(archive.is_file() and not archive.is_symlink() and
            archive.stat().st_mode & 0o077 == 0 and 0 < archive.stat().st_size < 128 * 1024 * 1024,
            'artifact_archive_invalid')
    require(hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['archiveSha256'], 'artifact_hash_mismatch')
    require(date(manifest['expiresAt']) > dt.datetime.now(dt.timezone.utc) +
            dt.timedelta(hours=minimum_hours), 'artifact_expiring')
    try:
        helper_module().validate_archive(archive)
    except Exception:
        raise RenewalError('artifact_archive_unsafe') from None


# Only the existing coordinator pod reads credentials; Grid receives no token.
COORDINATOR_CALL = r"""
const fs=require('node:fs');const input=JSON.parse(fs.readFileSync(0,'utf8'));
const origins={coordinator:'http://127.0.0.1:8080',stf:input.stfApiUrl,grid:input.gridUrl};
const files={coordinator:'/secrets/api-token',stf:'/secrets/stf-token'};
(async()=>{
 if(!Object.hasOwn(origins,input.target))throw Error();
 const headers={'Content-Type':'application/json'};
 if(files[input.target])headers.Authorization='Bearer '+fs.readFileSync(files[input.target],'utf8').trim();
 const response=await fetch(origins[input.target]+input.path,{method:input.method,
  redirect:'error',signal:AbortSignal.timeout(10000),headers,
  ...(input.body===undefined?{}:{body:JSON.stringify(input.body)})});
 process.stdout.write(JSON.stringify({status:response.status,body:await response.json()}));
})().catch(()=>{process.stdout.write(JSON.stringify({status:503,body:{error:{code:'upstream_unavailable'}}}));});
"""

RUNTIME_PROBE = r"""
const fs=require('fs');(async()=>{const headers={Authorization:'Bearer '+fs.readFileSync('/token/token','utf8').trim()};
const d=await fetch('http://127.0.0.1:7400/device',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
const body=await d.json();const s=await fetch('http://127.0.0.1:7400/screenshot',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
const b=Buffer.from(await s.arrayBuffer());console.log(JSON.stringify({deviceHttp:d.status,state:body.state,
wda:body.ios?.wda,screenshot:s.status===200&&b.length>32&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&b.toString('ascii',12,16)==='IHDR'&&b.readUInt32BE(16)>0&&b.readUInt32BE(20)>0&&b.toString('ascii',b.length-8,b.length-4)==='IEND'}));
})().catch(()=>process.exit(1));
"""


RUNTIME_IDENTITY_PROBE = r"""
const fs=require('fs');(async()=>{
const headers={Authorization:'Bearer '+fs.readFileSync('/token/token','utf8').trim()};
const response=await fetch('http://127.0.0.1:7400/device',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
if(!response.ok)throw Error();
const body=await response.json();
console.log(JSON.stringify({serial:body.udid,bundleId:body.ios?.wda?.bundleId}));
})().catch(()=>process.exit(1));
"""


EXPIRED_USB_PROBE = r"""
const fs=require('fs'),cp=require('child_process');
const {serial,bundleId}=JSON.parse(fs.readFileSync(0,'utf8'));
const profiles=JSON.parse(cp.execFileSync('pymobiledevice3',['provision','list','--udid='+serial],
  {encoding:'utf8',timeout:20000,maxBuffer:4194304}));
const matches=profiles.filter(p=>p.Entitlements?.['application-identifier']?.split('.').slice(1).join('.')===bundleId&&
  p.ProvisionedDevices?.includes(serial));
console.log(JSON.stringify({matches:matches.length,local:matches[0]?.LocalProvision,expiresAt:matches[0]?.ExpirationDate}));
"""


COMPLETED_HEALTH_PROBE = r"""
const fs=require('fs'),cp=require('child_process');const input=JSON.parse(fs.readFileSync(0,'utf8'));
(async()=>{const headers={Authorization:'Bearer '+fs.readFileSync('/token/token','utf8').trim()};
const d=await fetch('http://127.0.0.1:7400/device',{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
const device=await d.json();const w=await fetch('http://127.0.0.1:18100/status',{redirect:'error',signal:AbortSignal.timeout(10000)});const wda=await w.json();
const profiles=JSON.parse(cp.execFileSync('pymobiledevice3',['provision','list','--udid='+input.serial],{encoding:'utf8',timeout:20000,maxBuffer:4194304}));
const matches=profiles.filter(p=>p.Entitlements?.['application-identifier']?.split('.').slice(1).join('.')===input.bundleId&&p.ProvisionedDevices?.includes(input.serial));
let expiry=matches[0]?.ExpirationDate;if(expiry&&!/[Zz]|[+-]\d\d:\d\d$/.test(expiry))expiry+='Z';
console.log(JSON.stringify({deviceHttp:d.status,state:device.state,wdaProfile:device.ios?.wda?.profile,
expiresAt:device.ios?.wda?.expiresAt,wdaHttp:w.status,wdaReady:wda.value?.ready,
selectedProfileCount:matches.length,expectedProfilePresent:matches[0]?.UUID===input.profileUUID,installedExpiresAt:expiry}));
})().catch(()=>process.exit(1));
"""


class Worker:
    def __init__(self, config, target, state_dir):
        require(re.fullmatch(r'[A-Za-z0-9-]{8,80}', target.get('serial', '')) and
                re.fullmatch(r'[A-Za-z0-9_.-]{3,255}', target.get('bundleId', '')), 'invalid_target')
        require(isinstance(config.get('gridUrl'), str) and config['gridUrl'], 'grid_url_required')
        self.config, self.target = config, target
        self.state_dir = Path(state_dir)
        self.state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        require(not self.state_dir.is_symlink() and self.state_dir.stat().st_mode & 0o077 == 0,
                'private_directory_required')
        self.log = self.state_dir / (target['serial'] + '.private.log')
        self.journal = self.state_dir / (target['serial'] + '.json')
        self.state = None
        self.service_email = None

    def kubectl(self, *arguments, data=None, timeout=25, allow_failure=False):
        command = [self.config.get('kubectl', 'kubectl'), '--kubeconfig',
                   self.config['kubeconfig'], '--request-timeout=15s', *arguments]
        result = subprocess.run(command, input=data, capture_output=True, timeout=timeout)
        with self.log.open('ab') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(result.stderr)
        if not allow_failure:
            require(result.returncode == 0, 'kubernetes_operation_failed')
        return result

    def json(self, *arguments):
        return json.loads(self.kubectl(*arguments).stdout)

    def call(self, target, method, path, body=None, allowed=(200, 202)):
        request = {'target': target, 'method': method, 'path': path,
                   'stfApiUrl': self.config['stfApiUrl'].rstrip('/'),
                   'gridUrl': self.config['gridUrl'].rstrip('/')}
        if body is not None:
            request['body'] = body
        response = json.loads(self.kubectl('exec', '-i',
            'deployment/' + self.config['coordinatorDeployment'], '-n',
            self.config['coordinatorNamespace'], '-c', 'coordinator', '--',
            'node', '-e', COORDINATOR_CALL, data=json.dumps(request).encode()).stdout)
        require(response['status'] in allowed, 'farm_api_' + str(response['status']))
        require(response['body'].get('success') is not False, 'farm_operation_failed')
        return response['body']

    def device(self):
        result = self.call('stf', 'GET', '/devices/' + self.target['serial'])
        require(result.get('device', {}).get('serial') == self.target['serial'] and
                result['device'].get('platform') == 'iOS', 'device_missing')
        return result['device']

    def identity(self):
        if self.service_email is None:
            self.service_email = self.call('stf', 'GET', '/user').get('user', {}).get('email')
            require(isinstance(self.service_email, str) and self.service_email, 'stf_identity_unavailable')
        return self.service_email

    def owned(self, device, operation_id):
        return (device.get('automationLeaseId') == operation_id and
                (device.get('owner') or {}).get('email') == self.identity() and
                device.get('usage') == 'automation' and device.get('using') is True)

    def assert_unowned(self, device):
        require(not device.get('owner') and not device.get('using') and
                not device.get('claimed') and not device.get('automationLeaseId'), 'device_not_free')

    def assert_free(self, device):
        self.assert_unowned(device)
        require(device.get('present') is True and device.get('ready') is True, 'device_not_ready')

    def assert_grid_free(self, allow_offline=False):
        if allow_offline:
            require(self.state is not None and self.guard_deployment()['spec'].get('replicas', 1) == 0 and
                    not self.pods(), 'offline_grid_requires_stopped_deployment')
        grid = self.call('grid', 'GET', '/status').get('value', {})
        require(grid.get('ready') is True and isinstance(grid.get('nodes'), list), 'grid_unavailable')
        target_slots = []
        for node in grid['nodes']:
            require(isinstance(node, dict) and isinstance(node.get('slots'), list), 'grid_sessions_unconfirmed')
            for slot in node['slots']:
                require(isinstance(slot, dict) and isinstance(slot.get('stereotype'), dict) and
                        'session' in slot, 'grid_sessions_unconfirmed')
                session = slot['session']
                if session is not None:
                    require(isinstance(session, dict) and isinstance(session.get('capabilities'), dict) and
                            isinstance(session['capabilities'].get('appium:udid'), str) and
                            bool(session['capabilities']['appium:udid']), 'grid_sessions_unconfirmed')
                    require(session['capabilities']['appium:udid'] != self.target['serial'], 'grid_target_busy')
                if slot['stereotype'].get('appium:udid') == self.target['serial']:
                    require(session is None, 'grid_target_busy')
                    allowed = ('UP', 'DOWN') if allow_offline else ('UP',)
                    require(node.get('availability') in allowed, 'grid_relay_unavailable')
                    target_slots.append(slot)
        require(bool(target_slots), 'grid_target_missing')

    def capture(self, operation_id):
        device = self.device()
        self.assert_grid_free()
        if self.owned(device, operation_id):
            self.call('stf', 'POST', '/user/devices/' + self.target['serial'] +
                      '/automation/renew', {'leaseId': operation_id, 'timeout': 900000})
        else:
            self.assert_free(device)
            self.call('stf', 'POST', '/user/devices', {'serial': self.target['serial'],
                'leaseId': operation_id, 'timeout': 900000})
        require(self.owned(self.device(), operation_id), 'maintenance_capture_unconfirmed')

    def release(self, operation_id):
        device = self.device()
        if device.get('automationLeaseId') == operation_id:
            require(self.owned(device, operation_id), 'maintenance_ownership_changed')
            self.call('stf', 'POST', '/user/devices/' + self.target['serial'] +
                      '/automation/release', {'leaseId': operation_id})
            self.wait(lambda: self.unowned_now(), 30, 1)
        else:
            self.assert_unowned(device)

    def unowned_now(self):
        device = self.device()
        return not any(device.get(k) for k in ('owner', 'using', 'claimed', 'automationLeaseId'))

    def deployment(self):
        return self.json('get', 'deployment', self.target['deployment'], '-n', self.target['namespace'], '-o', 'json')

    def prototype_env_value(self, prototype, name):
        entries = [env for env in prototype.get('env', []) if env['name'] == name]
        require(len(entries) == 1, 'prototype_identity_environment')
        entry = entries[0]
        if 'value' in entry:
            return entry['value']
        ref = entry.get('valueFrom', {}).get('configMapKeyRef')
        require(ref and not ref.get('optional'), 'prototype_identity_environment')
        config_map = self.json('get', 'configmap', ref['name'], '-n', self.target['namespace'], '-o', 'json')
        return config_map.get('data', {}).get(ref['key'])

    def assert_prototype_target(self, prototype):
        arguments = prototype.get('command', []) + prototype.get('args', [])
        for flag, name, target_key in (('--udid', 'IOS_UDID', 'serial'),
                                      ('--wda-bundle-id', 'WDA_BUNDLE_ID', 'bundleId')):
            matches = [(i, arg) for i, arg in enumerate(arguments) if arg == flag or arg.startswith(flag + '=')]
            require(len(matches) <= 1, 'prototype_identity_arguments')
            value = None
            if matches:
                index, arg = matches[0]
                if arg == flag:
                    require(index + 1 < len(arguments), 'prototype_identity_arguments')
                    value = arguments[index + 1]
                else:
                    value = arg.split('=', 1)[1]
            if value is None or value == '$(' + name + ')':
                value = self.prototype_env_value(prototype, name)
            require(value == self.target[target_key], 'prototype_target_mismatch')

    def selected_environment(self, deployment):
        spec = deployment['spec']['template']['spec']
        prototype = next((c for c in spec['containers'] if c['name'] == 'prototype'), None)
        require(prototype and re.search(r'@sha256:[a-f0-9]{64}$', prototype.get('image', '')),
                'installer_image_must_be_pinned')
        security = {**spec.get('securityContext', {}), **prototype.get('securityContext', {})}
        require(security.get('runAsUser') == 1000 and security.get('runAsGroup') == 1000 and
                prototype.get('securityContext', {}).get('allowPrivilegeEscalation') is False,
                'unexpected_prototype_identity')
        self.assert_prototype_target(prototype)
        return prototype

    def guard_deployment(self):
        deployment = self.deployment()
        self.selected_environment(deployment)
        if self.state:
            require(deployment['metadata']['uid'] == self.state['deploymentUid'] and
                    digest(deployment['spec']['template']) == self.state['templateHash'],
                    'deployment_changed')
        return deployment

    def pods(self):
        deployment = self.deployment()
        selector = deployment['spec']['selector'].get('matchLabels', {})
        require(selector and not deployment['spec']['selector'].get('matchExpressions'), 'unsupported_deployment_selector')
        return self.json('get', 'pods', '-n', self.target['namespace'], '-l',
            ','.join(k + '=' + v for k, v in selector.items()), '-o', 'json')['items']

    def ready_pod(self):
        pods = [p for p in self.pods() if not p['metadata'].get('deletionTimestamp')]
        if len(pods) != 1:
            return None
        pod = pods[0]
        statuses = pod.get('status', {}).get('containerStatuses', [])
        containers = {c['name'] for c in pod['spec'].get('containers', [])}
        required = {'prototype', 'tunnel', 'stf-provider'}
        ready = {s['name'] for s in statuses if s.get('ready') is True}
        if (pod.get('status', {}).get('phase') != 'Running' or not required <= containers or
                len(statuses) != len(containers) or ready != containers):
            return None
        return pod

    def wait(self, operation, timeout=300, interval=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = operation()
            if value:
                return value
            time.sleep(interval)
        raise RenewalError('renewal_wait_timeout')

    def scale(self, expected, replicas):
        deployment = self.guard_deployment()
        require(deployment['spec'].get('replicas', 1) == expected, 'deployment_replica_conflict')
        self.kubectl('scale', 'deployment/' + self.target['deployment'], '-n', self.target['namespace'],
            '--current-replicas=' + str(expected), '--resource-version=' + deployment['metadata']['resourceVersion'],
            '--replicas=' + str(replicas))

    def restore(self):
        deployment = self.guard_deployment()
        replicas = deployment['spec'].get('replicas', 1)
        require(replicas in (0, 1), 'deployment_replica_conflict')
        if replicas == 0:
            require(self.helper_pod(self.operation_helper_spec('install')) is None,
                    'installer_removal_unconfirmed')
            self.scale(0, 1)

    def usbmuxd_socket(self, pod_spec, prototype):
        mounts = [m for m in prototype.get('volumeMounts', []) if m.get('mountPath') == '/run/usbmuxd']
        require(len(mounts) == 1 and mounts[0].get('readOnly') is True and
                not any(mounts[0].get(k) for k in ('subPath', 'subPathExpr')), 'unexpected_usbmuxd_socket')
        volumes = [v for v in pod_spec.get('volumes', []) if v['name'] == mounts[0]['name']]
        require(len(volumes) == 1, 'unexpected_usbmuxd_socket')
        socket = volumes[0].get('hostPath', {})
        path = socket.get('path')
        require(socket.get('type') == 'Socket' and isinstance(path, str) and path.startswith('/') and
                path != '/' and not path.startswith('//') and os.path.normpath(path) == path and
                '\x00' not in path, 'unexpected_usbmuxd_socket')
        return socket

    def helper_spec(self, deployment, pod, name):
        template = deployment['spec']['template']['spec']
        prototype = self.selected_environment(deployment)
        socket = self.usbmuxd_socket(template, prototype)
        require(pod['spec'].get('nodeName'), 'unexpected_usbmuxd_socket')
        return {'apiVersion': 'v1', 'kind': 'Pod', 'metadata': {'name': name,
            'namespace': self.target['namespace'], 'labels': {'stf-wda-renewal': 'installer'}},
            'spec': {'nodeName': pod['spec']['nodeName'], 'restartPolicy': 'Never',
                'activeDeadlineSeconds': 900, 'automountServiceAccountToken': False,
                'enableServiceLinks': False, 'imagePullSecrets': template.get('imagePullSecrets', []),
                'tolerations': template.get('tolerations', []),
                'securityContext': {'runAsNonRoot': True, 'runAsUser': 1000, 'runAsGroup': 1000, 'fsGroup': 1000},
                'containers': [{'name': 'installer', 'image': prototype['image'],
                    'command': ['python3', '-c', 'import time;time.sleep(850)'],
                    'securityContext': {'allowPrivilegeEscalation': False,
                        'readOnlyRootFilesystem': True, 'capabilities': {'drop': ['ALL']}},
                    'resources': {'requests': {'cpu': '50m', 'memory': '128Mi'}, 'limits': {'cpu': '1', 'memory': '512Mi'}},
                    'volumeMounts': [{'name': 'usbmuxd', 'mountPath': '/run/usbmuxd', 'readOnly': True},
                        {'name': 'work', 'mountPath': '/work'}, {'name': 'tmp', 'mountPath': '/tmp'}]}],
                'volumes': [{'name': 'usbmuxd', 'hostPath': socket},
                    {'name': 'work', 'emptyDir': {'sizeLimit': '512Mi'}}, {'name': 'tmp', 'emptyDir': {'sizeLimit': '64Mi'}}]}}

    def assert_selected_pod(self, pod, deployment):
        pod_spec = pod.get('spec', {})
        containers = pod_spec.get('containers', [])
        prototype = [c for c in containers if c.get('name') == 'prototype']
        expected = self.selected_environment(deployment)
        require(len(prototype) == 1 and prototype[0].get('image') == expected['image'],
                'phone_pod_identity_mismatch')
        owners = [o for o in pod['metadata'].get('ownerReferences', []) if o.get('controller')]
        require(len(owners) == 1 and owners[0].get('kind') == 'ReplicaSet', 'phone_pod_owner_mismatch')
        replica_set = self.json('get', 'replicaset', owners[0]['name'], '-n', self.target['namespace'], '-o', 'json')
        require(replica_set['metadata']['uid'] == owners[0].get('uid') and any(
            o.get('controller') and o.get('kind') == 'Deployment' and
            o.get('uid') == deployment['metadata']['uid'] for o in
            replica_set['metadata'].get('ownerReferences', [])), 'phone_pod_owner_mismatch')
        self.assert_prototype_target(prototype[0])
        require(self.usbmuxd_socket(pod_spec, prototype[0]) ==
                self.usbmuxd_socket(deployment['spec']['template']['spec'], expected), 'unexpected_usbmuxd_socket')
        identity = json.loads(self.kubectl('exec', pod['metadata']['name'], '-n', self.target['namespace'],
                             '-c', 'prototype', '--', 'node', '-e', RUNTIME_IDENTITY_PROBE).stdout)
        require(identity == {'serial': self.target['serial'], 'bundleId': self.target['bundleId']},
                'phone_runtime_identity_mismatch')

    def prepare(self, manifest):
        device = self.device()
        profile = device.get('ios', {}).get('wda', {})
        require(profile.get('profile') in ('valid', 'expiring', 'expired'), 'current_profile_unknown')
        if profile.get('profile') == 'expired' and not (device.get('present') is True and device.get('ready') is True):
            require(self.config.get('allowExpiredWdaRecovery') is True, 'expired_recovery_disabled')
        previous = profile.get('expiresAt')
        require(previous and date(manifest['expiresAt']) > date(previous) + dt.timedelta(hours=24), 'profile_not_renewed')
        deployment = self.deployment()
        self.selected_environment(deployment)
        pods = [p for p in self.pods() if not p['metadata'].get('deletionTimestamp')]
        require(len(pods) == 1 and deployment['spec'].get('replicas', 1) == 1, 'single_phone_pod_required')
        self.assert_selected_pod(pods[0], deployment)
        operation_id = str(uuid.uuid4())
        state = {'version': 1, 'operationId': operation_id, 'serial': self.target['serial'],
                 'namespace': self.target['namespace'], 'deployment': self.target['deployment'],
                 'bundleId': self.target['bundleId'], 'archiveSha256': manifest['archiveSha256'],
                 'artifactIdentity': artifact_identity(manifest),
                 'previousExpiresAt': previous, 'phase': 'prepared', 'completed': False,
                 'deploymentUid': deployment['metadata']['uid'], 'templateHash': digest(deployment['spec']['template'])}
        state['helperSpec'] = self.helper_spec(deployment, pods[0], 'wda-renew-' + operation_id[:12])
        state['helperSpecHash'] = digest(state['helperSpec'])
        save_json(self.state_dir / (operation_id + '.deployment.json'), deployment)
        save_json(self.journal, state)
        return state

    def check_state(self, manifest):
        state = self.state
        require(state.get('version') == 1 and all(state.get(k) == self.target[k]
                for k in ('serial', 'namespace', 'deployment', 'bundleId')) and
                state.get('archiveSha256') == manifest['archiveSha256'] and
                state.get('artifactIdentity') == artifact_identity(manifest) and
                state.get('helperSpecHash') == digest(state['helperSpec']) and
                helper_module().valid_uuid(state.get('operationId')), 'journal_conflict')
        require(state['phase'] in ('prepared', 'installing', 'installed', 'launch_verified',
                'cleaning', 'cleaned', 'refreshing', 'verified', 'completed'), 'journal_phase_invalid')
        self.guard_deployment()

    def upload(self, pod, path, content):
        code = "import pathlib,sys;p=pathlib.Path(sys.argv[1]);p.write_bytes(sys.stdin.buffer.read());p.chmod(0o600)"
        self.kubectl('exec', '-i', pod, '-n', self.target['namespace'], '--', 'python3', '-c', code, path, data=content, timeout=45)

    def helper_pod(self, spec):
        result = self.kubectl('get', 'pod', spec['metadata']['name'], '-n', self.target['namespace'],
                              '--ignore-not-found', '-o', 'json', allow_failure=True)
        require(result.returncode == 0, 'helper_lookup_failed')
        if not result.stdout.strip():
            return None
        pod = json.loads(result.stdout)
        require(pod['metadata'].get('annotations', {}).get('stf-wda-operation') == self.state['operationId'] and
                pod['metadata']['annotations'].get('stf-wda-spec-hash') == digest(spec['spec']) and
                pod['spec'].get('nodeName') == spec['spec']['nodeName'] and
                pod['spec'].get('automountServiceAccountToken') is False and
                len(pod['spec'].get('containers', [])) == 1 and
                pod['spec']['containers'][0]['image'] == spec['spec']['containers'][0]['image'] and
                len(pod['spec'].get('volumes', [])) == 3, 'helper_identity_conflict')
        actual, expected = pod['spec'], spec['spec']
        require(all(actual.get(k) == expected.get(k) for k in ('nodeName', 'restartPolicy',
                'activeDeadlineSeconds', 'automountServiceAccountToken', 'enableServiceLinks',
                'volumes')) and not any(actual.get(k) for k in ('hostPID', 'hostIPC', 'hostNetwork')),
                'helper_identity_conflict')
        require(all(actual.get('securityContext', {}).get(k) == v for k, v in expected['securityContext'].items()),
                'helper_identity_conflict')
        container, wanted = actual['containers'][0], expected['containers'][0]
        require(all(container.get(k) == wanted[k] for k in ('name', 'image', 'command',
                'securityContext', 'volumeMounts')) and not any(container.get(k) for k in
                ('args', 'env', 'envFrom', 'volumeDevices', 'lifecycle')), 'helper_identity_conflict')
        return pod

    def delete_helper(self, spec):
        if self.helper_pod(spec) is None:
            return
        self.kubectl('delete', 'pod', spec['metadata']['name'], '-n', self.target['namespace'],
                     '--wait=true', '--timeout=55s', timeout=60)
        require(self.helper_pod(spec) is None, 'helper_deletion_unconfirmed')

    def save_helper_log(self, spec, mode):
        result = self.kubectl('exec', spec['metadata']['name'], '-n', self.target['namespace'], '--',
            'python3', '-c', "from pathlib import Path;import sys;p=Path('/work/installer.log');sys.stdout.buffer.write(p.read_bytes() if p.exists() else b'')", allow_failure=True)
        if result.returncode == 0:
            path = self.state_dir / (self.state['operationId'] + '.' + mode + '.installer.log')
            with path.open('ab') as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(result.stdout)

    def helper_started(self, pod):
        result = self.kubectl('exec', pod, '-n', self.target['namespace'], '--', 'python3', '-c',
                             "from pathlib import Path;print('yes' if Path('/work/started').exists() else 'no')")
        return result.stdout.strip() == b'yes'

    def helper_result(self, pod):
        result = self.kubectl('exec', pod, '-n', self.target['namespace'], '--', 'python3', '-c',
            "from pathlib import Path;p=Path('/work/result.json');print(p.read_text() if p.exists() else '{}')")
        return json.loads(result.stdout)

    def operation_helper_spec(self, mode):
        spec = json.loads(json.dumps(self.state['helperSpec']))
        if mode == 'cleanup':
            spec['metadata']['name'] += '-clean'
        spec['metadata']['annotations'] = {'stf-wda-operation': self.state['operationId'],
                                           'stf-wda-spec-hash': digest(spec['spec'])}
        return spec

    def helper_run(self, mode, manifest):
        spec = self.operation_helper_spec(mode)
        name = spec['metadata']['name']
        try:
            pod = self.helper_pod(spec)
            if pod and pod.get('status', {}).get('phase') in ('Failed', 'Succeeded'):
                self.save_helper_log(spec, mode)
                self.delete_helper(spec)
                pod = None
            if pod is None:
                self.kubectl('create', '-f', '-', data=json.dumps(spec).encode())
            self.wait(lambda: (self.helper_pod(spec) or {}).get('status', {}).get('phase') == 'Running', 180)
            if mode == 'install':
                require(self.guard_deployment()['spec'].get('replicas', 1) == 0 and not self.pods(),
                        'installer_requires_stopped_deployment')
                self.assert_grid_free(allow_offline=True)
            else:
                self.capture(self.state['operationId'])
            result = self.helper_result(name)
            if not result and not self.helper_started(name):
                request = {**manifest, 'mode': mode, 'serial': self.target['serial'],
                           'previousExpiresAt': self.state['previousExpiresAt'],
                           'minValidityHours': self.config.get('minValidityHours', 48)}
                if mode == 'cleanup':
                    result_install = self.state['installResult']
                    request.update(launchVerified=True, obsoleteProfiles=result_install['obsoleteProfiles'],
                                   expectedTeamIdentifier=result_install['expectedTeamIdentifier'])
                if mode == 'install':
                    self.upload(name, '/work/runner.zip', Path(manifest['archivePath']).read_bytes())
                self.upload(name, '/work/request.json', json.dumps(request).encode())
                self.upload(name, '/work/install-helper.py', Path(__file__).with_name('install-helper.py').read_bytes())
                if mode == 'install':
                    self.assert_grid_free(allow_offline=True)
                self.kubectl('exec', name, '-n', self.target['namespace'], '--', 'python3', '-c',
                    "import os,subprocess;f=os.open('/work/started',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);os.close(f);subprocess.Popen(['python3','/work/install-helper.py'],start_new_session=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)")
            if not result:
                result = self.wait(lambda: self.helper_result(name), 300)
            save_json(self.state_dir / (self.state['operationId'] + '.' + mode + '.json'), result)
            require(result.get('ok') is True and result.get('mode') == mode and
                    result.get('profileUUID') == manifest['profileUUID'] and
                    date(result['expiresAt']) == date(manifest['expiresAt']), 'installer_failed')
            return result
        finally:
            # Do not start the provider until the USB installer has gone.
            try:
                self.save_helper_log(spec, mode)
            finally:
                self.delete_helper(spec)
                if mode == 'install':
                    self.restore()

    def expired_usb_proof(self, device):
        require(self.config.get('allowExpiredWdaRecovery') is True, 'expired_recovery_disabled')
        self.assert_unowned(device)
        wda = device.get('ios', {}).get('wda', {})
        require(wda.get('profile') == 'expired' and wda.get('expiresAt') and
                date(wda['expiresAt']) <= dt.datetime.now(dt.timezone.utc), 'device_not_ready')
        pods = [p for p in self.pods() if not p['metadata'].get('deletionTimestamp')]
        require(len(pods) == 1, 'single_phone_pod_required')
        self.assert_selected_pod(pods[0], self.guard_deployment())
        identity = {'serial': self.target['serial'], 'bundleId': self.target['bundleId']}
        result = json.loads(self.kubectl('exec', '-i', pods[0]['metadata']['name'], '-n', self.target['namespace'],
                    '-c', 'prototype', '--', 'node', '-e', EXPIRED_USB_PROBE,
                    data=json.dumps(identity).encode(), timeout=45).stdout)
        expiry = result.get('expiresAt')
        if expiry and not re.search(r'Z$|[+-]\d\d:\d\d$', expiry):
            expiry += 'Z'
        require(result.get('matches') == 1 and result.get('local') is True and expiry and
                date(expiry) == date(wda['expiresAt']), 'expired_usb_proof_failed')

    def stop_for_install(self):
        replicas = self.guard_deployment()['spec'].get('replicas', 1)
        if replicas == 1:
            device = self.device()
            self.assert_grid_free()
            if device.get('ready') is True and device.get('present') is True:
                self.capture(self.state['operationId'])
            else:
                self.expired_usb_proof(device)
                self.state['expiredRecovery'] = True
            self.state['phase'] = 'installing'
            save_json(self.journal, self.state)
            # Recheck immediately before stopping, including fresh Grid state.
            self.assert_grid_free()
            current = self.device()
            if not self.owned(current, self.state['operationId']):
                self.assert_unowned(current)
                require(self.state.get('expiredRecovery') is True, 'maintenance_capture_unconfirmed')
            self.scale(1, 0)
        else:
            require(replicas == 0 and self.state['phase'] == 'installing', 'deployment_replica_conflict')
            self.wait(lambda: not self.pods(), 180)
            self.assert_grid_free(allow_offline=True)
            current = self.device()
            if not self.owned(current, self.state['operationId']):
                self.assert_unowned(current)
        self.wait(lambda: not self.pods(), 180)

    def runtime_probe(self, pod):
        return json.loads(self.kubectl('exec', pod['metadata']['name'], '-n', self.target['namespace'],
                         '-c', 'prototype', '--', 'node', '-e', RUNTIME_PROBE).stdout)

    def verify_runtime(self, operation_id, manifest, intermediate=False):
        self.guard_deployment()
        pod = self.ready_pod()
        device = self.device()
        if not pod or device.get('ready') is not True or device.get('present') is not True:
            return False
        self.assert_selected_pod(pod, self.guard_deployment())
        try:
            self.assert_grid_free()
        except RenewalError as error:
            if str(error) in ('grid_relay_unavailable', 'grid_unavailable'):
                return False
            raise
        self.capture(operation_id)
        result = self.runtime_probe(pod)
        wda = result.get('wda', {})
        require(result.get('deviceHttp') == 200 and result.get('state') == 'ready' and
                result.get('screenshot') is True, 'wda_verification_failed')
        if intermediate:
            require(wda.get('profile') in ('valid', 'expiring', 'ambiguous'), 'wda_verification_failed')
        else:
            require(wda.get('profile') == 'valid' and wda.get('expiresAt') and
                    date(wda['expiresAt']) == date(manifest['expiresAt']), 'wda_verification_failed')
        return True

    def refresh_restart(self):
        if self.guard_deployment()['spec'].get('replicas', 1) == 1:
            self.capture(self.state['operationId'])
            self.state['phase'] = 'refreshing'
            save_json(self.journal, self.state)
            self.assert_grid_free()
            self.scale(1, 0)
        try:
            self.wait(lambda: not self.pods(), 180)
        finally:
            self.restore()

    def completed_health_probe(self, pod, manifest):
        request = {'profileUUID': manifest['profileUUID'], 'serial': self.target['serial'],
                   'bundleId': self.target['bundleId']}
        return json.loads(self.kubectl('exec', '-i', pod['metadata']['name'], '-n', self.target['namespace'],
            '-c', 'prototype', '--', 'node', '-e', COMPLETED_HEALTH_PROBE,
            data=json.dumps(request).encode(), timeout=45).stdout)

    def completed_result(self, manifest):
        self.check_state(manifest)
        pod, device = self.ready_pod(), self.device()
        require(pod and device.get('present') is True and device.get('ready') is True,
                'completed_runtime_unhealthy')
        self.assert_selected_pod(pod, self.guard_deployment())
        profile = device.get('ios', {}).get('wda', {})
        require(profile.get('profile') == 'valid' and profile.get('expiresAt') and
                date(profile['expiresAt']) == date(manifest['expiresAt']), 'completed_profile_mismatch')
        health = self.completed_health_probe(pod, manifest)
        require(health.get('deviceHttp') == 200 and health.get('state') == 'ready' and
                health.get('wdaHttp') == 200 and health.get('wdaReady') is True and
                health.get('wdaProfile') == 'valid' and health.get('selectedProfileCount') == 1 and
                health.get('expectedProfilePresent') is True and health.get('expiresAt') and
                health.get('installedExpiresAt') and
                date(health['expiresAt']) == date(manifest['expiresAt']) == date(health['installedExpiresAt']),
                'completed_runtime_unhealthy')
        # This is a read-only replay, even if another CI lease already started.
        return {'status': 'renewed', 'expiresAt': manifest['expiresAt']}

    def safety_restore(self):
        errors = []
        if self.state and not self.state.get('completed'):
            removed = set()
            for mode in ('install', 'cleanup'):
                try:
                    spec = self.operation_helper_spec(mode)
                    try:
                        if self.helper_pod(spec):
                            self.save_helper_log(spec, mode)
                    finally:
                        self.delete_helper(spec)
                        removed.add(mode)
                except Exception:
                    errors.append('helper_cleanup_failed')
            if 'install' in removed:
                try:
                    self.restore()
                except Exception:
                    errors.append('deployment_restore_failed')
                try:
                    self.release(self.state['operationId'])
                except Exception:
                    errors.append('maintenance_release_unconfirmed')
            else:
                errors.append('installer_removal_unconfirmed')
            if errors:
                self.state['cleanupErrors'] = errors
                save_json(self.journal, self.state)
        return errors

    def confirmed_drain(self, response, operation_id):
        maintenance = response.get('maintenance', {})
        require(isinstance(maintenance, dict) and maintenance.get('id') == operation_id and
                maintenance.get('serial') == self.target['serial'] and
                maintenance.get('state') in ('draining', 'ready'), 'maintenance_identity_unconfirmed')
        return maintenance['state'] == 'ready'

    def _run(self, manifest):
        self.state = private_json(self.journal) if self.journal.exists() else None
        may_recover = False
        try:
            validate_artifact(manifest, self.target, self.config.get('minValidityHours', 48))
            if self.state and self.state.get('completed'):
                if self.state.get('artifactIdentity') == artifact_identity(manifest):
                    return self.completed_result(manifest)
                self.state = None
            if not self.state:
                self.state = self.prepare(manifest)
            self.check_state(manifest)
            operation_id = self.state['operationId']
            drain = self.call('coordinator', 'POST', '/api/v1/maintenance',
                              {'serial': self.target['serial'], 'operationId': operation_id})
            self.confirmed_drain(drain, operation_id)
            may_recover = True
            self.wait(lambda: self.confirmed_drain(self.call('coordinator', 'GET', '/api/v1/maintenance/' +
                operation_id), operation_id), self.config.get('drainTimeoutSeconds', 7200), 15)
            phase = self.state['phase']
            if phase in ('prepared', 'installing'):
                self.stop_for_install()
                result = self.helper_run('install', manifest)
                self.state.update(phase='installed', installResult=result)
                save_json(self.journal, self.state)
            if self.state['phase'] != 'refreshing':
                self.restore()
            if self.state['phase'] in ('installed', 'launch_verified', 'cleaning'):
                self.wait(lambda: self.verify_runtime(operation_id, manifest, intermediate=True), 300)
                self.state['phase'] = 'launch_verified'
                save_json(self.journal, self.state)
                if self.state['installResult']['obsoleteProfiles']:
                    self.state['phase'] = 'cleaning'
                    save_json(self.journal, self.state)
                    self.capture(operation_id)
                    self.helper_run('cleanup', manifest)
                    self.state['phase'] = 'cleaned'
                    save_json(self.journal, self.state)
                else:
                    self.state['phase'] = 'verified'
                    save_json(self.journal, self.state)
            if self.state['phase'] in ('cleaned', 'refreshing'):
                self.refresh_restart()
                self.state['phase'] = 'verified'
                save_json(self.journal, self.state)
            self.wait(lambda: self.verify_runtime(operation_id, manifest), 300)
            self.release(operation_id)
            self.assert_grid_free()
            may_recover = False
            self.call('coordinator', 'DELETE', '/api/v1/maintenance/' + operation_id)
            self.state.update(phase='completed', completed=True, expiresAt=manifest['expiresAt'])
            self.state.pop('cleanupErrors', None)
            save_json(self.journal, self.state)
            return {'status': 'renewed', 'expiresAt': manifest['expiresAt']}
        finally:
            if may_recover:
                self.safety_restore()

    def run(self, manifest):
        lock_path = self.state_dir / (self.target['serial'] + '.lock')
        require(not lock_path.is_symlink(), 'private_file_required')
        with lock_path.open('a') as lock:
            os.fchmod(lock.fileno(), 0o600)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RenewalError('worker_already_running') from None
            return self._run(manifest)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--serial', required=True)
    args = parser.parse_args()
    try:
        config = private_json(args.config)
        require(config.get('version') == 1, 'config_version')
        target = next(d for d in config['devices'] if d['serial'] == args.serial)
        result = Worker(config, target, config['stateDirectory']).run(private_json(args.manifest))
        print(json.dumps(result))
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': str(error) if isinstance(error, RenewalError)
                          else type(error).__name__}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
