"""Offline renewal safety tests: fake farm, Kubernetes, USB commands and archives."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import stat
import subprocess
import shutil
import tempfile
import unittest
from unittest.mock import patch
import uuid
import zipfile
import warnings
warnings.filterwarnings('ignore', message='Duplicate name:', category=UserWarning)

ROOT = Path(__file__).parent

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

worker = load('renewal_worker', 'worker.py')
helper = load('renewal_helper', 'install-helper.py')
SERIAL = '00008110-TEST000000000000'
BUNDLE = 'test.Wda.xctrunner'
NEW_ID = '11111111-1111-4111-8111-111111111111'
OLD_ID = '22222222-2222-4222-8222-222222222222'
FOREIGN_ID = '33333333-3333-4333-8333-333333333333'
NOW = dt.datetime.now(dt.timezone.utc)
EXPIRES = (NOW + dt.timedelta(days=7)).replace(microsecond=0)
PREVIOUS = (NOW + dt.timedelta(hours=2)).replace(microsecond=0)

def iso(value):
    return value.isoformat().replace('+00:00', 'Z')

def app_files():
    prefix = helper.APP + '/'
    return {prefix + 'Info.plist': plistlib.dumps({'CFBundleIdentifier': BUNDLE,
        'CFBundleVersion': '1', 'CFBundleExecutable': 'Runner'}),
        prefix + 'embedded.mobileprovision': b'CMS', prefix + '_CodeSignature/CodeResources': b'signature',
        prefix + 'PlugIns/WebDriverAgentRunner.xctest/Info.plist': b'plist', prefix + 'Runner': b'arm64'}

def archive(path, extra=None):
    with zipfile.ZipFile(path, 'w') as z:
        for name, data in app_files().items():
            z.writestr(name, data)
        if extra:
            extra(z)
    path.chmod(0o600)
    return path

def manifest(path):
    return {'version': 1, 'bundleId': BUNDLE, 'deviceUDIDs': [SERIAL], 'profileUUID': NEW_ID,
            'expiresAt': iso(EXPIRES), 'archivePath': str(path),
            'archiveSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'sourceSHA': 'a' * 40}

class FakeFarm(worker.Worker):
    def __init__(self, root):
        config = {'kubeconfig': '/explicit/private/config', 'coordinatorNamespace': 'stf',
                  'coordinatorDeployment': 'stf-coordinator', 'stfApiUrl': 'http://stf/api/v1',
                  'gridUrl': 'http://grid:4444'}
        target = {'serial': SERIAL, 'bundleId': BUNDLE, 'namespace': 'ios', 'deployment': 'phone'}
        super().__init__(config, target, root)
        self.api_calls, self.scales, self.helpers, self.uploads = [], [], {}, {}
        self.busy_grid, self.delete_fails, self.empty_statuses = False, False, False
        self.delete_persists = False
        self.delete_calls = 0
        self.install_count, self.clean_count, self.renew_count = 0, 0, 0
        self.drain, self.installed, self.cleaned, self.refreshed = False, False, False, False
        self.drain_id = None
        self.reject_drain = False
        self.wrong_post_drain_id = False
        self.obsolete = True
        self.owner = None
        self.marker = None
        self.ready = True
        self.present = True
        self.profile_state = 'expiring'
        self.previous = PREVIOUS
        self.usb_matches = 1
        self.usb_local = True
        self.hide_absent_owner = False
        self.grid_availability = 'UP'
        self.unknown_grid_session = False
        self.runtime_serial = SERIAL
        self.runtime_bundle = BUNDLE
        self.usb_probe_data = None
        self.active_drain = False
        self.drain_reads = 0
        self.probe_fails = False
        self.deploy = {'metadata': {'uid': 'deployment-uid', 'resourceVersion': '1'}, 'spec': {
            'replicas': 1, 'selector': {'matchLabels': {'instance': 'phone'}}, 'template': {'spec': {
            'containers': [{'name': 'prototype', 'image': 'test/runtime@sha256:' + 'a' * 64,
             'env': [{'name': 'IOS_UDID', 'valueFrom': {'configMapKeyRef': {'name': 'identity', 'key': 'udid'}}},
                     {'name': 'WDA_BUNDLE_ID', 'value': BUNDLE}],
             'securityContext': {'runAsUser': 1000, 'runAsGroup': 1000, 'allowPrivilegeEscalation': False},
             'volumeMounts': [{'name': 'usb', 'mountPath': '/run/usbmuxd', 'readOnly': True}]},
             {'name': 'appium'}, {'name': 'tunnel'}, {'name': 'stf-provider'}],
            'volumes': [{'name': 'usb', 'hostPath': {'path': '/run/usbmuxd', 'type': 'Socket'}}]}}}}
        self.map_serial = SERIAL

    def call(self, target, method, path, body=None, allowed=(200, 202)):
        self.api_calls.append((target, method, path, copy.deepcopy(body)))
        if target == 'grid':
            return {'value': {'ready': True, 'nodes': [{'availability': self.grid_availability, 'slots': [{
                'stereotype': {'appium:udid': SERIAL},
                'session': {} if self.unknown_grid_session else {'capabilities': {'appium:udid': SERIAL}} if self.busy_grid else None}]}]}}
        if target == 'coordinator':
            if method == 'POST':
                if self.reject_drain:
                    raise worker.RenewalError('farm_api_409')
                self.drain = True
                self.drain_id = body['operationId']
            if method == 'DELETE':self.drain = False
            drain_id = 'another-operation' if method == 'POST' and self.wrong_post_drain_id else self.drain_id
            if self.active_drain and method == 'GET':
                self.drain_reads += 1
                if self.drain_reads == 1:
                    return {'maintenance': {'id': drain_id, 'serial': SERIAL, 'state': 'draining'}}
                self.owner = self.marker = None
                self.active_drain = False
            return {'maintenance': {'id': drain_id, 'serial': SERIAL, 'state': 'ready'}}
        if path == '/user':return {'user': {'email': 'farm-service@example.invalid'}}
        if method == 'GET':
            live = self.deploy['spec']['replicas'] == 1
            return {'device': {'serial': SERIAL, 'platform': 'iOS', 'present': self.present and live,
                'ready': self.ready and live, 'owner': None if self.hide_absent_owner and not live else self.owner, 'using': bool(self.owner),
                'usage': 'automation' if self.owner else None, 'automationLeaseId': self.marker,
                'ios': {'wda': {'profile': ('ambiguous' if self.obsolete and not self.refreshed else 'valid') if self.installed else self.profile_state, 'expiresAt': iso(EXPIRES if self.installed and (not self.obsolete or self.refreshed) else self.previous)}}}}
        if path.endswith('/automation/renew'):
            self.renew_count += 1
        elif path.endswith('/automation/release'):
            self.owner = self.marker = None
        else:
            self.owner = {'email': 'farm-service@example.invalid'}
            self.marker = body['leaseId']
        return {'success': True}

    def pod(self):
        spec = copy.deepcopy(self.deploy['spec']['template']['spec'])
        names = [container['name'] for container in spec['containers']]
        return {'metadata': {'name': 'phone-pod', 'ownerReferences': [{'controller': True, 'kind': 'ReplicaSet', 'name': 'phone-rs', 'uid': 'rs-uid'}]}, 'spec': {**spec, 'nodeName': 'usb-worker'},
                'status': {'phase': 'Running', 'containerStatuses': [] if self.empty_statuses else
                           [{'name': n, 'ready': True} for n in names]}}

    def json(self, *args):
        if args[:2] == ('get', 'deployment'):return copy.deepcopy(self.deploy)
        if args[:2] == ('get', 'replicaset'):return {'metadata': {'uid': 'rs-uid', 'ownerReferences': [{'controller': True, 'kind': 'Deployment', 'uid': 'deployment-uid'}]}}
        if args[:2] == ('get', 'configmap'):return {'data': {'udid': self.map_serial}}
        if args[:2] == ('get', 'pods'):return {'items': [self.pod()] if self.deploy['spec']['replicas'] else []}
        raise AssertionError(args)

    def kubectl(self, *args, data=None, **kwargs):
        if args[0] == 'scale':
            replica = int(next(a.split('=')[1] for a in args if a.startswith('--replicas=')))
            self.scales.append(replica)
            self.deploy['spec']['replicas'] = replica
            if replica:
                self.owner = self.marker = None
                self.ready = self.present = True
                if self.cleaned:self.refreshed = True
                self.grid_availability = 'UP'
            return subprocess.CompletedProcess([], 0, b'', b'')
        if args[:2] == ('get', 'pod'):
            pod = self.helpers.get(args[2])
            self.assert_ignore_not_found(args)
            return subprocess.CompletedProcess([], 0, json.dumps(pod).encode() if pod else b'', b'')
        if args[0] == 'create':
            spec = json.loads(data)
            self.helpers[spec['metadata']['name']] = {**spec, 'status': {'phase': 'Running'}}
            return subprocess.CompletedProcess([], 0, b'', b'')
        if args[0] == 'delete':
            self.delete_calls += 1
            if self.delete_fails:raise worker.RenewalError('injected_delete_failure')
            if not self.delete_persists:
                self.helpers.pop(args[2], None)
            return subprocess.CompletedProcess([], 0, b'', b'')
        if args[0] == 'exec':
            name = args[1]
            code = args[-1]
            if 'subprocess.Popen' in code:
                self.helpers[name]['started'] = True
                request = json.loads(self.uploads[(name, '/work/request.json')])
                if request['mode'] == 'install':
                    self.install_count += 1;self.installed = True
                    result = {'ok': True, 'mode': 'install', 'profileUUID': NEW_ID,
                        'expiresAt': iso(EXPIRES), 'expectedTeamIdentifier': ['TEST_TEAM'],
                        'obsoleteProfiles': [{'UUID': OLD_ID}] if self.obsolete else []}
                else:
                    self.clean_count += 1;self.cleaned = True
                    result = {'ok': True, 'mode': 'cleanup', 'profileUUID': NEW_ID, 'expiresAt': iso(EXPIRES)}
                self.helpers[name]['result'] = result
                return subprocess.CompletedProcess([], 0, b'', b'')
            if 'installer.log' in code:return subprocess.CompletedProcess([], 0, b'private installer evidence', b'')
            if code == worker.RUNTIME_IDENTITY_PROBE:
                result = {'serial': self.runtime_serial, 'bundleId': self.runtime_bundle}
                return subprocess.CompletedProcess([], 0, json.dumps(result).encode(), b'')
            if code == worker.EXPIRED_USB_PROBE:
                self.usb_probe_data = json.loads(data)
                result = {'matches': self.usb_matches, 'local': self.usb_local, 'expiresAt': iso(self.previous)}
                return subprocess.CompletedProcess([], 0, json.dumps(result).encode(), b'')
        raise AssertionError(args)

    def assert_ignore_not_found(self, args):
        if '--ignore-not-found' not in args:
            raise AssertionError(args)

    def upload(self, pod, path, content):self.uploads[(pod, path)] = content
    def helper_started(self, pod):return self.helpers[pod].get('started', False)
    def helper_result(self, pod):return self.helpers[pod].get('result', {})
    def runtime_probe(self, pod):
        if self.probe_fails:raise worker.RenewalError('injected_probe_failure')
        return {'deviceHttp': 200, 'state': 'ready', 'screenshot': True,
                'wda': {'profile': 'ambiguous' if self.obsolete and not self.refreshed else 'valid',
                        'expiresAt': iso(EXPIRES).replace('Z', '.000Z')}}
    def completed_health_probe(self, pod, manifest):
        return {'deviceHttp': 200, 'state': 'ready', 'wdaProfile': 'valid', 'expiresAt': iso(EXPIRES),
                'wdaHttp': 200, 'wdaReady': not self.probe_fails, 'selectedProfileCount': 1,
                'expectedProfilePresent': True, 'installedExpiresAt': iso(EXPIRES)}
    def wait(self, operation, timeout=300, interval=5):
        for _ in range(4):
            value = operation()
            if value:return value
        raise worker.RenewalError('renewal_wait_timeout')

class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name);self.root.chmod(0o700)
        self.path = archive(self.root / 'runner.zip')
        self.manifest = manifest(self.path)
        self.farm = FakeFarm(self.root / 'state')
    def tearDown(self):self.tmp.cleanup()

    def test_full_two_stage_success_and_private_evidence(self):
        result = self.farm.run(self.manifest)
        self.assertEqual(result['status'], 'renewed')
        self.assertEqual((self.farm.install_count, self.farm.clean_count), (1, 1))
        self.assertEqual(self.farm.scales, [0, 1, 0, 1])
        self.assertFalse(self.farm.owner);self.assertFalse(self.farm.marker);self.assertFalse(self.farm.drain)
        self.assertGreater(self.farm.renew_count, 0)
        state = worker.private_json(self.farm.journal)
        self.assertTrue(state['completed'])
        self.assertTrue(all(p.stat().st_mode & 0o077 == 0 for p in self.farm.state_dir.iterdir()))

    def test_capture_renews_same_uuid_and_service_owner_only(self):
        operation = str(uuid.uuid4())
        self.farm.capture(operation);self.farm.capture(operation)
        self.assertEqual(self.farm.renew_count, 1)
        self.farm.owner = {'email': 'other@example.invalid'}
        count = len(self.farm.api_calls)
        with self.assertRaises(worker.RenewalError):self.farm.capture(operation)
        self.assertFalse(any(m == 'POST' for _, m, _, _ in self.farm.api_calls[count:]))
        with self.assertRaises(worker.RenewalError):self.farm.release(operation)
        self.assertIsNotNone(self.farm.owner)

    def test_busy_grid_or_foreign_owner_never_stops_device(self):
        self.farm.busy_grid = True
        with self.assertRaises(worker.RenewalError):self.farm.run(self.manifest)
        self.assertFalse(self.farm.scales)
        self.assertTrue(self.farm.drain)
        self.farm = FakeFarm(self.root / 'other-state')
        self.farm.owner = {'email': 'other@example.invalid'}
        with self.assertRaises(worker.RenewalError):self.farm.run(self.manifest)
        self.assertFalse(self.farm.scales)
        self.assertEqual(self.farm.owner['email'], 'other@example.invalid')

    def test_wrong_configmap_identity_never_stops(self):
        self.farm.map_serial = 'ANOTHER-PHONE'
        with self.assertRaisesRegex(worker.RenewalError, 'prototype_target_mismatch'):
            self.farm.run(self.manifest)
        self.assertFalse(self.farm.scales)

    def test_helm_args_socket_and_readiness_without_an_appium_sidecar(self):
        spec = self.farm.deploy['spec']['template']['spec']
        prototype = spec['containers'][0]
        prototype['env'] = [{'name': 'HOME', 'value': '/home/node/home'}]
        prototype['args'] = ['--udid=' + SERIAL, '--wda-bundle-id', BUNDLE, '--token-file=/token/token']
        spec['containers'] = [c for c in spec['containers'] if c['name'] != 'appium']
        spec['volumes'][0]['hostPath']['path'] = '/run/custom-usbmuxd.sock'
        spec['imagePullSecrets'] = [{'name': 'registry-read'}]
        spec['tolerations'] = [{'key': 'usb', 'operator': 'Exists', 'effect': 'NoExecute'}]
        self.assertIsNotNone(self.farm.ready_pod())
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')
        state = worker.private_json(self.farm.journal)
        helper_spec = state['helperSpec']['spec']
        self.assertEqual(helper_spec['volumes'][0]['hostPath'],
                         {'path': '/run/custom-usbmuxd.sock', 'type': 'Socket'})
        self.assertEqual(helper_spec['imagePullSecrets'], spec['imagePullSecrets'])
        self.assertEqual(helper_spec['tolerations'], spec['tolerations'])
        self.assertIs(helper_spec['automountServiceAccountToken'], False)

    def test_explicit_args_have_precedence_without_permitting_duplicate_flags(self):
        prototype = self.farm.deploy['spec']['template']['spec']['containers'][0]
        prototype['args'] = ['--udid=ANOTHER-PHONE', '--wda-bundle-id=' + BUNDLE]
        with self.assertRaisesRegex(worker.RenewalError, 'prototype_target_mismatch'):
            self.farm.run(self.manifest)
        prototype['args'][0] = '--udid=$(IOS_UDID)'
        self.farm.assert_prototype_target(prototype)
        prototype['args'].append('--udid=' + SERIAL)
        with self.assertRaisesRegex(worker.RenewalError, 'prototype_identity_arguments'):
            self.farm.run(self.manifest)
        self.assertFalse(self.farm.scales)

    def test_preflight_rejects_a_live_pod_for_another_target(self):
        self.farm.runtime_serial = 'ANOTHER-PHONE'
        with self.assertRaisesRegex(worker.RenewalError, 'phone_runtime_identity_mismatch'):
            self.farm.run(self.manifest)
        self.assertFalse(self.farm.scales)
        self.assertFalse(self.farm.drain)

    def test_socket_mount_must_name_a_read_only_host_socket(self):
        spec = self.farm.deploy['spec']['template']['spec']
        mount = spec['containers'][0]['volumeMounts'][0]
        mount['name'] = 'not-the-socket'
        with self.assertRaisesRegex(worker.RenewalError, 'unexpected_usbmuxd_socket'):
            self.farm.run(self.manifest)
        mount['name'] = 'usb'
        mount['readOnly'] = False
        with self.assertRaisesRegex(worker.RenewalError, 'unexpected_usbmuxd_socket'):
            self.farm.run(self.manifest)
        self.assertFalse(self.farm.scales)

    def test_all_declared_phone_containers_must_be_ready(self):
        pod = self.farm.pod()
        pod['spec']['containers'].append({'name': 'extra-proxy'})
        with patch.object(self.farm, 'pods', return_value=[pod]):
            self.assertIsNone(self.farm.ready_pod())
            pod['status']['containerStatuses'].append({'name': 'extra-proxy', 'ready': False})
            self.assertIsNone(self.farm.ready_pod())
            pod['status']['containerStatuses'][-1]['ready'] = True
            self.assertEqual(self.farm.ready_pod(), pod)

    def test_delete_failure_keeps_provider_stopped_until_installer_is_removed(self):
        self.farm.delete_fails = True
        with self.assertRaises(worker.RenewalError):self.farm.run(self.manifest)
        self.assertEqual(self.farm.deploy['spec']['replicas'], 0)
        self.assertTrue(self.farm.drain)
        self.assertTrue(list(self.farm.state_dir.glob('*.installer.log')))
        self.assertTrue(self.farm.helpers)
        journal = worker.private_json(self.farm.journal)
        self.assertIn('installer_removal_unconfirmed', journal['cleanupErrors'])
        self.farm.delete_fails = False
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')
        self.assertEqual(self.farm.install_count, 1)
        self.assertEqual(self.farm.deploy['spec']['replicas'], 1)
        self.assertFalse(self.farm.drain)

    def test_successful_delete_response_without_absence_does_not_restart_provider(self):
        self.farm.delete_persists = True
        with self.assertRaisesRegex(worker.RenewalError, 'helper_deletion_unconfirmed'):
            self.farm.run(self.manifest)
        self.assertEqual(self.farm.scales, [0])
        self.assertTrue(self.farm.drain)
        self.assertTrue(self.farm.helpers)

    def test_log_failure_still_removes_installer_before_restoring_provider(self):
        with patch.object(self.farm, 'save_helper_log', side_effect=OSError('log failed')):
            with self.assertRaisesRegex(OSError, 'log failed'):
                self.farm.run(self.manifest)
        self.assertEqual(self.farm.scales, [0, 1])
        self.assertFalse(self.farm.helpers)
        self.assertTrue(self.farm.drain)

    def test_unconfirmed_drain_does_not_restore_paused_provider_or_touch_helpers(self):
        for case in ('reject_drain', 'wrong_post_drain_id'):
            with self.subTest(case=case):
                farm = FakeFarm(self.root / case)
                farm.state = farm.prepare(self.manifest)
                worker.save_json(farm.journal, farm.state)
                farm.deploy['spec']['replicas'] = 0
                setattr(farm, case, True)
                with self.assertRaises(worker.RenewalError):
                    farm.run(self.manifest)
                self.assertEqual(farm.deploy['spec']['replicas'], 0)
                self.assertFalse(farm.scales)
                self.assertEqual(farm.delete_calls, 0)
                self.assertFalse(any(path.endswith('/automation/release') for _, _, path, _ in farm.api_calls))

    def test_crash_resume_after_scale_zero_uses_persisted_snapshot(self):
        self.farm.state = self.farm.prepare(self.manifest)
        self.farm.state['phase'] = 'installing'
        worker.save_json(self.farm.journal, self.farm.state)
        self.farm.deploy['spec']['replicas'] = 0
        self.farm.drain = True
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')
        self.assertEqual(self.farm.install_count, 1)
        self.assertEqual(self.farm.deploy['spec']['replicas'], 1)

    def test_changed_template_is_not_overwritten_on_resume(self):
        self.farm.state = self.farm.prepare(self.manifest)
        self.farm.state['phase'] = 'installing';worker.save_json(self.farm.journal, self.farm.state)
        self.farm.deploy['spec']['replicas'] = 0
        self.farm.deploy['spec']['template']['spec']['containers'][0]['image'] = 'changed@sha256:' + 'b' * 64
        with self.assertRaisesRegex(worker.RenewalError, 'deployment_changed'):
            self.farm.run(self.manifest)
        self.assertFalse(self.farm.scales)
        self.assertEqual(self.farm.deploy['spec']['replicas'], 0)

    def test_invalid_artifact_cannot_restore_replica_without_confirming_the_drain(self):
        self.farm.state = self.farm.prepare(self.manifest)
        self.farm.state['phase'] = 'installing';worker.save_json(self.farm.journal, self.farm.state)
        self.farm.deploy['spec']['replicas'] = 0
        self.farm.drain = True
        self.manifest['expiresAt'] = iso(NOW - dt.timedelta(hours=1))
        with self.assertRaisesRegex(worker.RenewalError, 'artifact_expiring'):
            self.farm.run(self.manifest)
        self.assertEqual(self.farm.deploy['spec']['replicas'], 0)
        self.assertFalse(self.farm.scales)
        self.assertTrue(self.farm.drain)

    def test_empty_container_statuses_cannot_prove_runtime(self):
        self.farm.empty_statuses = True
        self.assertFalse(self.farm.verify_runtime(str(uuid.uuid4()), self.manifest))
        self.assertFalse(any(m == 'POST' for _,m,_,_ in self.farm.api_calls))

    def test_failed_runtime_releases_only_own_marker_and_retains_drain(self):
        self.farm.probe_fails = True
        with self.assertRaises(worker.RenewalError):self.farm.run(self.manifest)
        self.assertEqual(self.farm.deploy['spec']['replicas'], 1)
        self.assertFalse(self.farm.owner);self.assertFalse(self.farm.marker)
        self.assertTrue(self.farm.drain)
        self.assertEqual(self.farm.clean_count, 0)

    def test_manifest_hash_and_ttl_fail_before_any_farm_mutation(self):
        for change in [{'archiveSha256': 'f' * 64}, {'expiresAt': iso(NOW + dt.timedelta(hours=1))}]:
            with self.subTest(change=change):
                value = {**self.manifest, **change}
                with self.assertRaises(worker.RenewalError):self.farm.run(value)
                self.assertFalse(self.farm.api_calls)

    def test_expired_recovery_requires_fresh_unique_usb_profile(self):
        self.farm.previous = NOW - dt.timedelta(hours=1)
        self.farm.ready = self.farm.present = False
        self.farm.profile_state = 'expired'
        with self.assertRaisesRegex(worker.RenewalError, 'expired_recovery_disabled'):
            self.farm.run(self.manifest)
        self.assertFalse(self.farm.scales)
        self.assertFalse(self.farm.drain)
        self.farm.config['allowExpiredWdaRecovery'] = True
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')
        self.assertEqual(self.farm.usb_probe_data, {'serial': SERIAL, 'bundleId': BUNDLE})
        state = worker.private_json(self.farm.journal)
        self.assertTrue(state['expiredRecovery'])
        self.assertEqual(self.farm.scales, [0, 1, 0, 1])

    def test_expired_recovery_rejects_unknown_ambiguous_and_foreign_profiles(self):
        for index, (profile, matches, local) in enumerate([
                ('unknown', 1, True), ('expired', 2, True), ('expired', 1, False)]):
            with self.subTest(profile=profile, matches=matches, local=local):
                farm = FakeFarm(self.root / ('expired-' + str(index)))
                farm.previous = NOW - dt.timedelta(hours=1)
                farm.ready = farm.present = False
                farm.profile_state, farm.usb_matches, farm.usb_local = profile, matches, local
                farm.config['allowExpiredWdaRecovery'] = True
                with self.assertRaises(worker.RenewalError):farm.run(self.manifest)
                self.assertFalse(farm.scales)
                if profile != 'unknown':self.assertTrue(farm.drain)

    def test_crash_resume_does_not_install_over_foreign_marker(self):
        self.farm.state = self.farm.prepare(self.manifest)
        self.farm.state['phase'] = 'installing';worker.save_json(self.farm.journal, self.farm.state)
        self.farm.deploy['spec']['replicas'] = 0
        self.farm.owner = {'email': 'other@example.invalid'}
        self.farm.marker = str(uuid.uuid4())
        with self.assertRaises(worker.RenewalError):self.farm.run(self.manifest)
        self.assertEqual(self.farm.install_count, 0)
        self.assertEqual(self.farm.deploy['spec']['replicas'], 1)
        self.assertFalse(any(path.endswith('/automation/release') for _, _, path, _ in self.farm.api_calls))

    def test_helper_with_drifted_mount_is_never_adopted_or_deleted(self):
        self.farm.state = self.farm.prepare(self.manifest)
        spec = copy.deepcopy(self.farm.state['helperSpec'])
        spec['metadata']['annotations'] = {'stf-wda-operation': self.farm.state['operationId'],
            'stf-wda-spec-hash': worker.digest(spec['spec'])}
        pod = copy.deepcopy(spec)
        pod['spec']['volumes'][0]['hostPath']['path'] = '/some-other-host-directory'
        self.farm.helpers[spec['metadata']['name']] = pod
        with self.assertRaisesRegex(worker.RenewalError, 'helper_identity_conflict'):
            self.farm.helper_pod(spec)
        with self.assertRaises(worker.RenewalError):self.farm.delete_helper(spec)
        self.assertIn(spec['metadata']['name'], self.farm.helpers)

    def test_no_obsolete_profile_skips_cleanup_and_second_restart(self):
        self.farm.obsolete = False
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')
        self.assertEqual(self.farm.scales, [0, 1])
        self.assertEqual(self.farm.clean_count, 0)

    def test_resume_waits_running_helper_without_reupload_or_second_install(self):
        self.farm.state = self.farm.prepare(self.manifest)
        self.farm.state['phase'] = 'installing';worker.save_json(self.farm.journal, self.farm.state)
        self.farm.deploy['spec']['replicas'] = 0
        spec = copy.deepcopy(self.farm.state['helperSpec'])
        spec['metadata']['annotations'] = {'stf-wda-operation': self.farm.state['operationId'],
            'stf-wda-spec-hash': worker.digest(spec['spec'])}
        name = spec['metadata']['name']
        self.farm.helpers[name] = {**spec, 'status': {'phase': 'Running'}, 'started': True}
        result = {'ok': True, 'mode': 'install', 'profileUUID': NEW_ID, 'expiresAt': iso(EXPIRES),
                  'expectedTeamIdentifier': ['TEST_TEAM'], 'obsoleteProfiles': []}
        self.farm.obsolete = False
        original = self.farm.helper_result
        calls = [0]
        def eventual(pod):
            if pod == name:
                calls[0] += 1
                return result if calls[0] > 1 else {}
            return original(pod)
        self.farm.helper_result = eventual
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')
        self.assertEqual(self.farm.install_count, 0)
        self.assertFalse(self.farm.uploads)

    def test_hidden_absent_owner_restores_then_next_retry_resumes_safely(self):
        self.farm.state = self.farm.prepare(self.manifest)
        self.farm.state['phase'] = 'installing';worker.save_json(self.farm.journal, self.farm.state)
        self.farm.deploy['spec']['replicas'] = 0
        self.farm.hide_absent_owner = True
        self.farm.owner = {'email': 'farm-service@example.invalid'}
        self.farm.marker = self.farm.state['operationId']
        with self.assertRaises(worker.RenewalError):self.farm.run(self.manifest)
        self.assertEqual(self.farm.deploy['spec']['replicas'], 1)
        self.assertEqual(self.farm.install_count, 0)
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')

    def test_existing_coordinator_lease_drains_without_worker_releasing_it(self):
        old_operation = str(uuid.uuid4())
        self.farm.owner = {'email': 'farm-service@example.invalid'}
        self.farm.marker = old_operation
        self.farm.active_drain = True
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')
        self.assertGreaterEqual(self.farm.drain_reads, 2)
        operations = [body for _, method, path, body in self.farm.api_calls
                      if method == 'POST' and path.endswith(('/automation/renew', '/automation/release'))]
        self.assertTrue(all(body['leaseId'] != old_operation for body in operations))

    def test_offline_relay_allowed_only_for_stopped_or_expired_proof(self):
        self.farm.grid_availability = 'DOWN'
        with self.assertRaisesRegex(worker.RenewalError, 'grid_relay_unavailable'):
            self.farm.assert_grid_free()
        with self.assertRaisesRegex(worker.RenewalError, 'offline_grid_requires_stopped_deployment'):
            self.farm.assert_grid_free(allow_offline=True)
        self.farm.state = self.farm.prepare(self.manifest)
        self.farm.deploy['spec']['replicas'] = 0
        self.farm.assert_grid_free(allow_offline=True)
        self.farm.unknown_grid_session = True
        with self.assertRaisesRegex(worker.RenewalError, 'grid_sessions_unconfirmed'):
            self.farm.assert_grid_free(allow_offline=True)

    def test_completed_replay_validates_live_profile_without_touching_new_ci_owner(self):
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')
        previous_installs = self.farm.install_count
        self.farm.owner = {'email': 'another-ci@example.invalid'}
        self.farm.marker = str(uuid.uuid4())
        call_count = len(self.farm.api_calls)
        self.assertEqual(self.farm.run(self.manifest)['status'], 'renewed')
        self.assertEqual(self.farm.install_count, previous_installs)
        self.assertEqual(self.farm.owner['email'], 'another-ci@example.invalid')
        self.assertTrue(all(method == 'GET' for _, method, _, _ in self.farm.api_calls[call_count:]))
        self.assertFalse(self.farm.drain)

    def test_completed_replay_rejects_bad_live_health_and_different_manifest(self):
        self.farm.run(self.manifest)
        self.farm.probe_fails = True
        with self.assertRaisesRegex(worker.RenewalError, 'completed_runtime_unhealthy'):
            self.farm.run(self.manifest)
        self.farm.probe_fails = False
        different = {**self.manifest, 'profileUUID': str(uuid.uuid4())}
        with self.assertRaisesRegex(worker.RenewalError, 'profile_not_renewed'):
            self.farm.run(different)
        self.assertEqual(self.farm.install_count, 1)
        self.assertFalse(self.farm.drain)

class RpcTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node is required only for coordinator RPC fixture')
    def test_grid_rpc_never_reads_or_sends_credentials(self):
        program = r"""const vm=require('node:vm');const source=JSON.parse(process.argv[1]);
const input={target:'grid',method:'GET',path:'/status',stfApiUrl:'http://stf/api/v1',gridUrl:'http://grid:4444'};
let read=0;const fakeFs={readFileSync(p){if(p!==0){read++;throw Error('credential read');}return JSON.stringify(input);}};
const context={require(name){if(name!=='node:fs')throw Error();return fakeFs;},AbortSignal,
fetch:async(url,options)=>{if(url!=='http://grid:4444/status'||options.headers.Authorization)throw Error('unexpected auth');return {status:200,json:async()=>({value:{ready:true}})};},
process:{stdout:{write(value){const result=JSON.parse(value);console.log(JSON.stringify({read,result}));}}}};
vm.runInNewContext(source,context);"""
        result = json.loads(subprocess.check_output(['node', '-e', program, json.dumps(worker.COORDINATOR_CALL)], text=True))
        self.assertEqual(result['read'], 0)
        self.assertEqual(result['result']['status'], 200)
        self.assertTrue(result['result']['body']['value']['ready'])

class ArchiveTests(unittest.TestCase):
    def test_malformed_traversal_symlink_special_and_duplicate_archives(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            bad = root / 'bad.zip';bad.write_bytes(b'not zip')
            with self.assertRaises(RuntimeError):helper.validate_archive(bad)
            def special(z, name, mode):
                entry = zipfile.ZipInfo(name);entry.external_attr = mode << 16;z.writestr(entry, b'x')
            poisons = [lambda z:z.writestr(helper.APP + '/../outside', b'x'),
                       lambda z:z.writestr('/absolute', b'x'),
                       lambda z:z.writestr(helper.APP + '/./dot', b'x'),
                       lambda z:special(z, helper.APP + '/link', stat.S_IFLNK | 0o777),
                       lambda z:special(z, helper.APP + '/device', stat.S_IFCHR | 0o600),
                       lambda z:z.writestr(helper.APP + '/Info.plist', b'duplicate')]
            for index, poison in enumerate(poisons):
                with self.subTest(index=index):
                    with warnings.catch_warnings():
                        warnings.simplefilter('ignore', UserWarning)
                        path = archive(root / (str(index) + '.zip'), poison)
                    with self.assertRaises(RuntimeError):helper.validate_archive(path)

class ToolEnvironmentTests(unittest.TestCase):
    def test_tool_home_and_xdg_directories_are_writable_private_and_outside_rootfs(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            result = subprocess.CompletedProcess([], 0, b'{}', b'')
            with patch.object(helper, 'WORK', work), patch.object(helper.subprocess, 'run', return_value=result) as run:
                helper.command(['pymobiledevice3', 'provision', 'list', '--udid=' + SERIAL])
            environment = run.call_args.kwargs['env']
            for name in ('HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME'):
                path = Path(environment[name])
                self.assertTrue(work in path.parents)
                self.assertTrue(path.is_dir())
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700)
                self.assertTrue(os.access(path, os.W_OK))
            self.assertEqual(environment.get('PATH'), os.environ.get('PATH'))
            self.assertEqual(stat.S_IMODE((work / 'installer.log').stat().st_mode), 0o600)

class HelperTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.work = Path(self.tmp.name);self.work.chmod(0o700)
        self.path = archive(self.work / 'runner.zip');self.request = {**manifest(self.path), 'serial': SERIAL,
            'previousExpiresAt': iso(PREVIOUS), 'minValidityHours': 48, 'mode': 'install'}
        self.new = self.profile(NEW_ID, EXPIRES)
        self.old = self.profile(OLD_ID, PREVIOUS)
        self.foreign = self.profile(FOREIGN_ID, EXPIRES);self.foreign['Entitlements']['application-identifier'] = 'TEAM.other.app'
        self.profiles = [self.old, self.foreign];self.calls = []
        self.work_patch = patch.object(helper, 'WORK', self.work);self.work_patch.start()
        self.command_patch = patch.object(helper, 'command', self.command);self.command_patch.start()
    def tearDown(self):self.command_patch.stop();self.work_patch.stop();self.tmp.cleanup()
    def profile(self, identity, expiry):
        return {'UUID': identity, 'ExpirationDate': expiry.replace(tzinfo=None), 'LocalProvision': True,
            'TeamIdentifier': ['TEST_TEAM'], 'Entitlements': {'application-identifier': 'TEAM.' + BUNDLE},
            'ProvisionedDevices': [SERIAL]}
    def command(self, args, timeout=30):
        self.calls.append(args)
        if args[0] == 'openssl':return plistlib.dumps(self.new)
        if args[0] == 'ios':
            self.profiles.insert(0, self.new)
            return b'{}'
        if args[1:3] == ['apps', 'query']:
            return json.dumps({BUNDLE: {'CFBundleIdentifier': BUNDLE, 'CFBundleVersion': '1', 'ProfileValidated': True}}).encode()
        if args[1:3] == ['provision', 'list']:
            def default(value):return value.isoformat() if isinstance(value, dt.datetime) else value
            return json.dumps(self.profiles, default=default).encode()
        if args[1:3] == ['provision', 'remove']:
            self.profiles = [p for p in self.profiles if p['UUID'] != args[-1]]
            return b'{}'
        raise AssertionError(args)

    def test_install_does_not_remove_any_profile_before_wda_launch(self):
        result = helper.install(self.request)
        self.assertTrue(result['ok']);self.assertEqual(len(result['obsoleteProfiles']), 1)
        self.assertFalse(any(c[1:3] == ['provision', 'remove'] for c in self.calls))
        self.assertIn(self.foreign, self.profiles)

    def test_cleanup_only_after_launch_and_exact_allowlist_preserves_foreign(self):
        installed = helper.install(self.request)
        request = {**self.request, **installed, 'mode': 'cleanup', 'launchVerified': False}
        with self.assertRaisesRegex(RuntimeError, 'wda_launch_not_verified'):helper.cleanup(request)
        request['launchVerified'] = True
        result = helper.cleanup(request)
        self.assertEqual(result['obsoleteWdaProfilesRemoved'], 1)
        self.assertEqual({p['UUID'] for p in self.profiles}, {NEW_ID, FOREIGN_ID})
        self.assertEqual(helper.cleanup(request)['obsoleteWdaProfilesRemoved'], 0)
        removes = [c for c in self.calls if c[1:3] == ['provision', 'remove']]
        self.assertEqual([c[-1] for c in removes], [OLD_ID])
        self.assertFalse(any('clear' in c for c in self.calls))

    def test_cleanup_refuses_missing_new_profile_or_new_foreign_exact_profile(self):
        result = helper.install(self.request)
        request = {**self.request, **result, 'mode': 'cleanup', 'launchVerified': True}
        self.profiles = [self.old, self.foreign]
        with self.assertRaisesRegex(RuntimeError, 'new_profile_not_installed'):helper.cleanup(request)
        self.profiles = [self.new, self.old, self.profile(str(uuid.uuid4()), PREVIOUS)]
        with self.assertRaisesRegex(RuntimeError, 'unexpected_obsolete_profile'):helper.cleanup(request)
        self.assertFalse(any(c[1:3] == ['provision', 'remove'] for c in self.calls))

    def test_expiry_offsets_are_semantic_and_mismatched_profile_fails_before_install(self):
        self.assertEqual(helper.timestamp('2026-10-23T19:44:57+02:00'), helper.timestamp('2026-10-23T17:44:57.000Z'))
        self.request['expiresAt'] = iso(EXPIRES + dt.timedelta(hours=1))
        with self.assertRaisesRegex(RuntimeError, 'profile_expiry_mismatch'):helper.install(self.request)
        self.assertFalse(any(c[0] == 'ios' for c in self.calls))

if __name__ == '__main__':unittest.main()
