"""Hardware-free template contracts. Requires Helm and PyYAML; no cluster access."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import yaml

CHART = Path(__file__).resolve().parents[1]
HELM = os.environ.get('HELM', 'helm')

def render(values=None, namespace='test-stf', release='stf', upgrade=False, failure=None):
    config = {'session': {'existingSecret': 'stf-session'}}
    config.update(values or {})
    with tempfile.NamedTemporaryFile('w', suffix='.json') as f:
        json.dump(config, f); f.flush()
        cmd = [HELM, 'template', release, str(CHART), '--namespace', namespace, '-f', f.name]
        if upgrade: cmd += ['--is-upgrade']
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if failure:
        if p.returncode == 0 or failure not in p.stderr: raise AssertionError(p.stderr)
        return
    if p.returncode: raise AssertionError(p.stderr)
    return [x for x in yaml.safe_load_all(p.stdout) if x]

def obj(items, kind, name):
    return next(x for x in items if x['kind'] == kind and x['metadata']['name'] == name)

def iphone(name='iphone-a', udid='00008100-0000000000000001'):
    return {'name': name, 'udid': udid, 'wdaBundleId': 'com.example.WDA.xctrunner',
            'tokenSecret': name + '-token', 'nodeSelector': {'kubernetes.io/hostname': 'usb-a'}}

IOS_IMAGE = {'repository': 'example.invalid/ios-runtime', 'tag': 'test'}

def coordinator(**overrides):
    return {'enabled': True, 'existingSecret': 'coordinator-credentials',
            'appiumGridUrl': 'http://grid.appium.svc:4444',
            'stfServiceAccountEmail': 'coordinator@example.test', **overrides}

class ChartTest(unittest.TestCase):
    def test_default_core_has_no_usb_and_exposes_only_http(self):
        items = render()
        self.assertEqual(len([x for x in items if x['kind'] == 'Deployment']), 13)
        self.assertEqual(obj(items, 'Service', 'stf-proxy')['spec']['ports'][0]['port'], 7100)
        self.assertFalse(any(x['kind'] == 'Secret' for x in items))
        for x in items:
            spec = x.get('spec', {})
            if x['kind'] == 'Service':
                self.assertEqual(spec.get('type', 'ClusterIP'), 'ClusterIP')
            pod = spec.get('template', {}).get('spec', {})
            self.assertFalse(pod.get('hostNetwork', False))
            self.assertFalse(any('hostPath' in v for v in pod.get('volumes', [])))
        self.assertFalse(any('coordinator' in x['metadata']['name'] for x in items))

    def test_coordinator_is_a_single_persistent_unprivileged_appium_gateway(self):
        items = render({'coordinator': coordinator()})
        deployment = obj(items, 'Deployment', 'stf-coordinator')['spec']
        self.assertEqual(len([x for x in items if x['kind'] == 'Deployment']), 14)
        self.assertEqual(deployment['replicas'], 1)
        self.assertEqual(deployment['strategy'], {'type': 'Recreate', 'rollingUpdate': None})
        pod = deployment['template']['spec']
        self.assertFalse(pod['automountServiceAccountToken'])
        self.assertFalse(pod['enableServiceLinks'])
        self.assertEqual(pod['terminationGracePeriodSeconds'], 120)
        self.assertEqual(pod['securityContext'], {'runAsNonRoot': True, 'runAsUser': 1000,
            'runAsGroup': 1000, 'fsGroup': 1000, 'fsGroupChangePolicy': 'OnRootMismatch',
            'seccompProfile': {'type': 'RuntimeDefault'}})
        self.assertEqual([c['name'] for c in pod['containers']], ['coordinator'])
        c = pod['containers'][0]
        self.assertEqual(c['command'], ['stf', 'coordinator'])
        self.assertEqual(c['image'], 'devicefarmer/stf:3.9.0')
        for flag in ['--stf-api-url=http://stf-api:7100/api/v1',
                     '--appium-grid-url=http://grid.appium.svc:4444',
                     '--public-url=http://stf-coordinator.test-stf.svc:8080',
                     '--state-file=/state/coordinator.json', '--adb-pools-file=/config/adb-pools.json']:
            self.assertIn(flag, c['args'])
        self.assertNotIn('env', c)
        self.assertNotIn('envFrom', c)
        self.assertEqual(c['securityContext'], {'allowPrivilegeEscalation': False,
            'readOnlyRootFilesystem': True, 'capabilities': {'drop': ['ALL']}})
        self.assertEqual(c['startupProbe']['httpGet'], {'path': '/healthz', 'port': 'http'})
        self.assertEqual(c['livenessProbe']['httpGet'], {'path': '/healthz', 'port': 'http'})
        self.assertEqual(c['readinessProbe']['httpGet'], {'path': '/readyz', 'port': 'http'})
        volumes = {v['name']: v for v in pod['volumes']}
        self.assertEqual(volumes['state']['persistentVolumeClaim']['claimName'], 'stf-coordinator-state')
        self.assertEqual(volumes['credentials']['secret'], {'secretName': 'coordinator-credentials',
            'defaultMode': 0o440, 'items': [{'key': 'stf-token', 'path': 'stf-token'},
                                        {'key': 'api-token', 'path': 'api-token'}]})
        self.assertEqual(volumes['tmp'], {'name': 'tmp', 'emptyDir': {}})
        self.assertTrue(all(m['readOnly'] for m in c['volumeMounts'] if m['name'] in ['credentials', 'adb-pools']))
        self.assertFalse(any(m['name'] == 'migration-identity' for m in c['volumeMounts']))
        self.assertEqual(obj(items, 'ConfigMap', 'stf-coordinator-adb-pools')['data'], {'adb-pools.json': '[]'})
        claim = obj(items, 'PersistentVolumeClaim', 'stf-coordinator-state')
        self.assertEqual(claim['spec']['accessModes'], ['ReadWriteOnce'])
        self.assertEqual(claim['metadata']['annotations']['helm.sh/resource-policy'], 'keep')
        service = obj(items, 'Service', 'stf-coordinator')['spec']
        self.assertEqual(service['type'], 'ClusterIP')
        self.assertEqual(service['ports'], [{'name': 'http', 'port': 8080, 'targetPort': 'http'}])
        self.assertFalse(any(x['kind'] == 'Ingress' or 'appium-grid' in x['metadata']['name'] for x in items))
        self.assertFalse(any(x['kind'] == 'Secret' for x in items))

    def test_coordinator_grants_managed_leases_only_on_its_local_stf_api(self):
        email = 'appium+coordinator@example.test'
        for values, expected in [
            (coordinator(stfServiceAccountEmail=email), [('stf-api', email)]),
            (coordinator(stfServiceAccountEmail=email, enabled=False), []),
            (coordinator(stfServiceAccountEmail=email, stfApiUrl='https://stf.example.test/api/v1'), []),
        ]:
            with self.subTest(values=values):
                accounts = [(item['metadata']['name'], entry['value'])
                            for item in render({'coordinator': values})
                            if item['kind'] == 'Deployment'
                            for container in item['spec']['template']['spec']['containers']
                            for entry in container.get('env', [])
                            if entry['name'] == 'STF_API_AUTOMATION_LEASE_ACCOUNTS']
                self.assertEqual(accounts, expected)

    def test_coordinator_external_api_adoption_keeps_existing_state_and_credentials(self):
        pool = {'provider': 'existing-provider', 'host': 'adb.example.test', 'port': 5038,
                'systemPorts': [8201, 8202]}
        values = {'coordinator': coordinator(stfApiUrl='https://api.example.test/api/v1',
                    publicUrl='https://ci.example.test', projectTokensKey='projects-v2.json',
                    maxParallel=8, upstreamTimeoutSeconds=120, adbPools=[pool],
                    persistence={'existingClaim': 'existing-coordinator-state'},
                    image={'repository': 'example.invalid/stf', 'digest': 'sha256:' + 'a' * 64},
                    nodeSelector={'role': 'services'}, tolerations=[{'key': 'services', 'operator': 'Exists'}],
                    podAnnotations={'credentials-revision': '2'}),
                  'networkPolicy': {'enabled': False},
                  'imagePullSecrets': [{'name': 'registry-pull'}],
                  'resourceNames': {'coordinator': 'previous-coordinator',
                      'coordinator-adb-pools': 'previous-pools'},
                  'selectorOverrides': {'coordinator': {'app': 'previous-coordinator'}}}
        items = render(values, namespace='another-ns', upgrade=True)
        spec = obj(items, 'Deployment', 'previous-coordinator')['spec']
        self.assertEqual(spec['selector']['matchLabels'], {'app': 'previous-coordinator'})
        self.assertEqual(spec['template']['metadata']['labels'], {'app': 'previous-coordinator'})
        self.assertEqual(spec['template']['metadata']['annotations']['credentials-revision'], '2')
        pod = spec['template']['spec']
        self.assertNotIn('initContainers', pod)
        self.assertNotIn('serviceAccountName', pod)
        self.assertEqual(pod['nodeSelector'], {'role': 'services'})
        self.assertEqual(pod['tolerations'], [{'key': 'services', 'operator': 'Exists'}])
        self.assertEqual(pod['imagePullSecrets'], [{'name': 'registry-pull'}])
        self.assertFalse(any(v.get('projected') or v.get('hostPath') for v in pod['volumes']))
        c = pod['containers'][0]
        self.assertEqual(c['image'], 'example.invalid/stf@sha256:' + 'a' * 64)
        for flag in ['--stf-api-url=https://api.example.test/api/v1', '--public-url=https://ci.example.test',
                     '--project-tokens-file=/secrets/projects.json', '--max-parallel=8', '--upstream-timeout-seconds=120']:
            self.assertIn(flag, c['args'])
        volumes = {v['name']: v for v in pod['volumes']}
        self.assertEqual(volumes['state']['persistentVolumeClaim'], {'claimName': 'existing-coordinator-state'})
        self.assertEqual(volumes['credentials']['secret']['items'][-1],
                         {'key': 'projects-v2.json', 'path': 'projects.json'})
        self.assertEqual(volumes['adb-pools']['configMap'], {'name': 'previous-pools'})
        self.assertFalse(any(x['kind'] == 'PersistentVolumeClaim' and 'coordinator' in x['metadata']['name'] for x in items))
        self.assertEqual(json.loads(obj(items, 'ConfigMap', 'previous-pools')['data']['adb-pools.json']), [pool])
        self.assertEqual(obj(items, 'Service', 'previous-coordinator')['spec']['selector'], {'app': 'previous-coordinator'})

    def test_coordinator_uses_local_migration_barrier_only_for_the_local_api(self):
        for enabled in [True, False]:
            items = render({'coordinator': coordinator(), 'migration': {'enabled': enabled}})
            pod = obj(items, 'Deployment', 'stf-coordinator')['spec']['template']['spec']
            if enabled:
                job = next(x for x in items if x['kind'] == 'Job')
                self.assertEqual(pod['initContainers'][0]['name'], 'wait-migration')
                self.assertIn({'name': 'MIGRATION_JOB', 'value': job['metadata']['name']}, pod['initContainers'][0]['env'])
            else:
                self.assertNotIn('initContainers', pod)
                self.assertNotIn('serviceAccountName', pod)
                self.assertFalse(any(v['name'] == 'migration-identity' for v in pod['volumes']))

    def test_coordinator_pool_change_rolls_the_pod_without_replacing_its_claim(self):
        def objects(ports, upgrade):
            pools = [{'provider': 'android-provider', 'host': 'adb', 'port': 5037, 'systemPorts': ports}]
            items = render({'coordinator': coordinator(adbPools=pools)}, upgrade=upgrade)
            return obj(items, 'Deployment', 'stf-coordinator'), obj(items, 'PersistentVolumeClaim', 'stf-coordinator-state')
        old, claim = objects([8200], False)
        same, same_claim = objects([8200], True)
        new, new_claim = objects([8201], True)
        self.assertEqual(old, same)
        self.assertNotEqual(old['spec']['template']['metadata']['annotations'], new['spec']['template']['metadata']['annotations'])
        self.assertEqual(claim, same_claim)
        self.assertEqual(claim, new_claim)

    def test_coordinator_requires_external_grid_and_rejects_unsafe_configuration(self):
        for field in ['existingSecret', 'appiumGridUrl', 'stfServiceAccountEmail']:
            render({'coordinator': coordinator(**{field: ''})}, failure=field)
        for email in ['missing-at', 'one@example.test,two@example.test', 'coordinator@example.test ']:
            render({'coordinator': coordinator(stfServiceAccountEmail=email)},
                   failure='stfServiceAccountEmail')
        for field in ['stfApiUrl', 'publicUrl', 'appiumGridUrl']:
            for url in ['ftp://grid', 'http://user:password@grid', 'http://grid?token=bad', 'http://grid/#token', 'http://grid/has space']:
                with self.subTest(field=field, url=url):
                    render({'coordinator': coordinator(**{field: url})}, failure=field)
        for override in [{'replicas': 2}, {'persistence': {'enabled': False}},
                         {'upstreamTimeoutSeconds': 301}, {'maxParallel': 0},
                         {'image': {'tag': 'alone'}}, {'image': {'repository': 'example.invalid/stf'}},
                         {'image': {'repository': 'example.invalid/stf', 'digest': ''}}]:
            render({'coordinator': coordinator(**override)}, failure='coordinator')
        render({'coordinator': coordinator(podAnnotations={'checksum/adb-pools': 'override'})}, failure='checksum/adb-pools')

    def test_coordinator_pool_validation_prevents_shared_system_ports(self):
        first = {'provider': 'a', 'host': 'adb', 'port': 5037, 'systemPorts': [8200]}
        for second, error in [(dict(first), 'provider names must be unique'),
                              (dict(first, provider='b', port=5038), 'systemPorts must not overlap'),
                              (dict(first, provider='b', port=8200, systemPorts=[8201]), 'ADB control port')]:
            render({'coordinator': coordinator(adbPools=[first, second])}, failure=error)
        render({'coordinator': coordinator(adbPools=[dict(first, systemPorts=[5037])])}, failure='ADB control port')
        for pool in [dict(first, systemPorts=[]), dict(first, systemPorts=[8200, 8200]),
                     dict(first, systemPorts=[1023]), dict(first, host='adb:5037'),
                     dict(first, port=65536)]:
            render({'coordinator': coordinator(adbPools=[pool])}, failure='adbPools')
        render({'coordinator': coordinator(adbPools=[first, dict(first, provider='b', host='another-adb')])})

    def test_coordinator_network_policy_allows_only_explicit_external_peers(self):
        values = {'coordinator': coordinator(), 'selectorOverrides': {'coordinator': {'app': 'legacy'}}}
        items = render(values)
        self.assertFalse(any(x['kind'] == 'NetworkPolicy' and x['metadata']['name'] == 'stf-coordinator' for x in items))
        labels = obj(items, 'Deployment', 'stf-coordinator')['spec']['template']['metadata']['labels']
        self.assertEqual(labels, {'app': 'legacy', 'app.kubernetes.io/instance': 'stf',
                                  'app.kubernetes.io/component': 'coordinator'})
        peers = [{'namespaceSelector': {'matchLabels': {'kubernetes.io/metadata.name': 'ci'}},
                  'podSelector': {'matchLabels': {'app': 'runner'}}}]
        values['networkPolicy'] = {'coordinatorFrom': peers}
        policy = obj(render(values), 'NetworkPolicy', 'stf-coordinator')['spec']
        self.assertEqual(policy['podSelector'], {'matchLabels': {
            'app.kubernetes.io/instance': 'stf', 'app.kubernetes.io/component': 'coordinator'}})
        self.assertEqual(policy['ingress'], [{'ports': [{'protocol': 'TCP', 'port': 'http'}], 'from': peers}])
        self.assertEqual(policy['policyTypes'], ['Ingress'])

    def test_coordinator_ingress_uses_its_own_explicit_origin_and_service(self):
        c = coordinator(publicUrl='https://ci.example.test', ingress={'enabled': True, 'className': 'private',
            'annotations': {'example.test/timeout': '120'}, 'tls': [{'hosts': ['ci.example.test'], 'secretName': 'ci-tls'}]})
        ingress = obj(render({'coordinator': c}), 'Ingress', 'stf-coordinator')
        self.assertEqual(ingress['metadata']['annotations'], {'example.test/timeout': '120'})
        self.assertEqual(ingress['spec']['ingressClassName'], 'private')
        self.assertEqual(ingress['spec']['tls'], c['ingress']['tls'])
        self.assertEqual(ingress['spec']['rules'], [{'host': 'ci.example.test', 'http': {'paths': [
            {'path': '/', 'pathType': 'Prefix', 'backend': {'service': {'name': 'stf-coordinator', 'port': {'name': 'http'}}}}]}}])
        for url in ['', 'https://ci.example.test/coordinator']:
            render({'coordinator': coordinator(publicUrl=url, ingress={'enabled': True})}, failure='coordinator.ingress')

    def test_coordinator_example_keeps_secrets_external_and_renders_the_gateway(self):
        with open(CHART / 'examples' / 'coordinator.yaml') as f:
            values = yaml.safe_load(f)
        items = render(values)
        pod = obj(items, 'Deployment', 'stf-coordinator')['spec']['template']['spec']
        self.assertEqual(pod['containers'][0]['image'], 'registry.example.com/stf:YOUR_VERSION')
        self.assertFalse(any(x['kind'] == 'Secret' for x in items))
        self.assertEqual(obj(items, 'NetworkPolicy', 'stf-coordinator')['spec']['ingress'][0]['from'],
                         values['networkPolicy']['coordinatorFrom'])
        claim = obj(items, 'PersistentVolumeClaim', 'stf-coordinator-state')
        self.assertEqual(claim['spec']['resources']['requests']['storage'], '1Gi')
        items = render({'coordinator': coordinator(persistence={'size': '2Gi', 'storageClass': 'fast',
                                   'annotations': {'example.test/backup': 'daily'}})})
        claim = obj(items, 'PersistentVolumeClaim', 'stf-coordinator-state')
        self.assertEqual(claim['spec']['storageClassName'], 'fast')
        self.assertEqual(claim['spec']['resources']['requests']['storage'], '2Gi')
        self.assertEqual(claim['metadata']['annotations'], {'helm.sh/resource-policy': 'keep',
                                                          'example.test/backup': 'daily'})

    def test_missing_secret_and_invalid_origin_fail_without_cluster(self):
        render({'session': {'existingSecret': ''}}, failure='existingSecret')
        render({'publicOrigin': 'https://stf.example.com/path'}, failure='publicOrigin')

    def test_nondefault_namespace_and_resource_identity_overrides(self):
        values = {'fullnameOverride': 'custom', 'resourceNames': {'api': 'previous-api'},
                  'selectorOverrides': {'api': {'app': 'previous-api'}},
                  'networkPolicy': {'enabled': False}}
        items = render(values, namespace='another-ns', release='custom-release')
        api = obj(items, 'Deployment', 'previous-api')['spec']
        self.assertEqual(api['selector']['matchLabels'], {'app': 'previous-api'})
        self.assertEqual(api['template']['metadata']['labels'], {'app': 'previous-api'})
        binding = next(x for x in items if x['kind'] == 'RoleBinding')
        self.assertEqual(binding['subjects'][0]['namespace'], 'another-ns')
        self.assertNotIn('stf.svc.cluster.local', json.dumps(items))

    def test_migration_is_not_a_hook_and_gate_can_read_only_that_job(self):
        items = render()
        job = next(x for x in items if x['kind'] == 'Job')
        self.assertNotIn('helm.sh/hook', job['metadata'].get('annotations', {}))
        self.assertNotIn('ttlSecondsAfterFinished', job['spec'])
        role = next(x for x in items if x['kind'] == 'Role')
        self.assertEqual(role['rules'], [{'apiGroups': ['batch'], 'resources': ['jobs'],
            'resourceNames': [job['metadata']['name']], 'verbs': ['get']}])
        for x in items:
            if x['kind'] != 'Deployment': continue
            pod = x['spec']['template']['spec']
            self.assertFalse(pod['automountServiceAccountToken'])
            self.assertEqual(pod['initContainers'][0]['name'], 'wait-migration')
            for c in pod['containers']:
                self.assertFalse(any(v['name'] == 'migration-identity' for v in c.get('volumeMounts', [])))

    def test_upgrade_hash_is_stable_until_migration_payload_changes(self):
        def name(values=None, **kw): return next(x['metadata']['name'] for x in render(values, **kw) if x['kind'] == 'Job')
        self.assertEqual(name(), name(upgrade=True))
        for v in [{'image': {'tag': 'changed'}}, {'migration': {'revision': '2'}},
                  {'session': {'existingSecret': 'other'}}, {'bootstrap': {'adminEmail': 'other@example.com'}},
                  {'ports': {'http': 3100}}, {'resourceNames': {'rethinkdb': 'previous-db'}},
                  {'selectorOverrides': {'migrate': {'app.kubernetes.io/instance': 'stf',
                                                 'app': 'previous-migrate'}}}]:
            self.assertNotEqual(name(), name(v))

    def test_enabling_isolation_replaces_migration_job_without_changing_legacy_selectors(self):
        overrides = {'migrate': {'app': 'previous-migrate'}, 'api': {'app': 'previous-api'}}
        renders = [render({'selectorOverrides': overrides, 'networkPolicy': {'enabled': enabled}},
                          upgrade=True) for enabled in (False, True)]
        jobs = [next(x for x in items if x['kind'] == 'Job') for items in renders]
        self.assertNotEqual(jobs[0]['spec']['template']['metadata']['labels'],
                            jobs[1]['spec']['template']['metadata']['labels'])
        self.assertNotEqual(jobs[0]['metadata']['name'], jobs[1]['metadata']['name'])
        for items, job in zip(renders, jobs):
            api = obj(items, 'Deployment', 'stf-api')['spec']
            self.assertEqual(api['selector']['matchLabels'], overrides['api'])
            self.assertEqual(obj(items, 'Service', 'stf-api')['spec']['selector'], overrides['api'])
            barrier = api['template']['spec']['initContainers'][0]
            self.assertIn({'name': 'MIGRATION_JOB', 'value': job['metadata']['name']}, barrier['env'])
            role = next(x for x in items if x['kind'] == 'Role')
            self.assertEqual(role['rules'][0]['resourceNames'], [job['metadata']['name']])

    def test_default_migration_preserves_existing_admin_and_explicit_override_is_forwarded(self):
        def env(values=None):
            job = next(x for x in render(values) if x['kind'] == 'Job')
            return {x['name']: x.get('value') for x in job['spec']['template']['spec']['containers'][0]['env']}
        self.assertNotIn('STF_ADMIN_EMAIL', env())
        self.assertNotIn('STF_ADMIN_NAME', env())
        custom = env({'bootstrap': {'adminEmail': 'owner@example.test', 'adminName': 'Owner'}})
        self.assertEqual(custom['STF_ADMIN_EMAIL'], 'owner@example.test')
        self.assertEqual(custom['STF_ADMIN_NAME'], 'Owner')

    def test_long_adopted_migration_name_retains_revision_hash(self):
        def job(revision):
            values = {'resourceNames': {'migrate': 'm' * 63}, 'migration': {'revision': revision}}
            return next(x['metadata']['name'] for x in render(values) if x['kind'] == 'Job')
        self.assertEqual(len(job('a')), 63)
        self.assertNotEqual(job('a'), job('b'))

    def test_external_database_and_existing_claims(self):
        items = render({'database': {'bundled': False, 'external': {'host': 'db.example',
            'existingSecret': 'db-auth'}}, 'storage': {'persistence': {'enabled': True, 'existingClaim': 'existing-storage'}}})
        self.assertFalse(any(x['kind'] in ['StatefulSet', 'PersistentVolumeClaim'] for x in items))
        storage = obj(items, 'Deployment', 'stf-storage')['spec']['template']['spec']
        self.assertIn({'name': 'storage', 'persistentVolumeClaim': {'claimName': 'existing-storage'}}, storage['volumes'])
        env = obj(items, 'Deployment', 'stf-api')['spec']['template']['spec']['containers'][0]['env']
        self.assertIn({'name': 'RETHINKDB_PORT_28015_TCP', 'value': 'tcp://db.example:28015'}, env)
        self.assertTrue(any(e['name'] == 'RETHINKDB_ENV_AUTHKEY' and 'secretKeyRef' in e['valueFrom'] for e in env))

    def test_android_pools_reuse_ports_without_service_or_usb_aliasing(self):
        providers = [{'name': 'a', 'capacity': 2, 'nodeSelector': {'kubernetes.io/hostname': 'usb-a'}},
                     {'name': 'b', 'capacity': 2, 'nodeSelector': {'kubernetes.io/hostname': 'usb-b'}}]
        items = render({'android': {'providers': providers}})
        selectors = []
        for n in ['a', 'b']:
            service = obj(items, 'Service', 'stf-android-' + n)['spec']
            self.assertEqual([p['port'] for p in service['ports']], list(range(7400, 7408)))
            selectors.append(service['selector'])
            self.assertEqual(obj(items, 'Deployment', 'stf-adb-' + n)['spec']['strategy']['type'], 'Recreate')
        self.assertNotEqual(*selectors)
        proxy = obj(items, 'ConfigMap', 'stf-proxy')['data']['nginx.conf']
        self.assertIn('location = /d/stf-android-a/7400/', proxy)
        self.assertNotIn('location = /d/stf-android-a/7401/', proxy)
        self.assertNotIn('resolver 10.', proxy)
        providers[1]['nodeSelector'] = providers[0]['nodeSelector']
        render({'android': {'providers': providers}}, failure='one USB ADB server')
        providers[1]['nodeSelector'] = {**providers[0]['nodeSelector'], 'stf.role': 'android'}
        render({'android': {'providers': providers}}, failure='one USB ADB server')
        providers[1]['nodeSelector'] = {'stf.role': 'android'}
        render({'android': {'providers': providers}}, failure='explicit kubernetes.io/hostname')
        render({'android': {'providers': [{'name': 'a', 'capacity': 2, 'minPort': 65532, 'nodeSelector': {'n': 'a'}}]}}, failure='port pool')

    def test_android_install_fetches_via_complete_gateway_not_raw_storage(self):
        provider = {'name': 'a', 'externalAdb': {'host': 'adb'}}
        def storage(values):
            items = render(values)
            pod = obj(items, 'Deployment', 'stf-android-a')['spec']['template']['spec']
            return next(a for a in pod['containers'][0]['args'] if a.startswith('--storage-url='))
        self.assertEqual(storage({'android': {'providers': [provider]}}), '--storage-url=http://stf-proxy:7100/')
        provider['storageUrl'] = 'https://farm.example.com/'
        self.assertEqual(storage({'android': {'providers': [provider]}}), '--storage-url=https://farm.example.com/')

    def test_recreate_adoption_explicitly_clears_rolling_update(self):
        items = render({'android': {'providers': [{'name': 'a', 'nodeSelector': {'kubernetes.io/hostname': 'usb-a'}}]},
                        'ios': {'image': IOS_IMAGE, 'devices': [iphone()]}})
        for name in ['stf-storage', 'stf-android-a', 'stf-adb-a', 'stf-ios-iphone-a']:
            strategy = obj(items, 'Deployment', name)['spec']['strategy']
            self.assertEqual(strategy, {'type': 'Recreate', 'rollingUpdate': None})

    def test_shared_external_adb_requires_disjoint_serials(self):
        providers = [{'name': 'a', 'externalAdb': {'host': 'adb'}, 'serials': ['one']},
                     {'name': 'b', 'externalAdb': {'host': 'adb'}, 'serials': ['two']}]
        items = render({'android': {'providers': providers}})
        self.assertFalse(any(x['kind'] == 'Deployment' and x['metadata']['name'].startswith('stf-adb-') for x in items))
        providers[1]['serials'] = ['one']
        render({'android': {'providers': providers}}, failure='same serial')
        providers[1]['serials'] = []
        render({'android': {'providers': providers}}, failure='explicit disjoint')

    def test_multiple_iphones_have_private_state_and_healthy_offline_runtime(self):
        phones = [iphone(), iphone('iphone-b', '00008100-0000000000000002')]
        phones[0]['persistence'] = {'existingClaim': 'previous-iphone-state'}
        phones[0]['extraContainers'] = [{'name': 'optional-adapter', 'image': 'example.invalid/adapter:test'}]
        phones[0]['appiumMjpegPort'] = 19100
        items = render({'ios': {'image': IOS_IMAGE, 'devices': phones}})
        for p in phones:
            pod = obj(items, 'Deployment', 'stf-ios-' + p['name'])['spec']['template']['spec']
            cs = {c['name']: c for c in pod['containers']}
            self.assertTrue(cs['tunnel']['securityContext']['privileged'])
            self.assertFalse(cs['prototype']['securityContext']['allowPrivilegeEscalation'])
            mjpeg_args = [arg for arg in cs['prototype']['args'] if arg.startswith('--appium-mjpeg-port=')]
            self.assertEqual(mjpeg_args, ['--appium-mjpeg-port=19100'] if p is phones[0] else [])
            health = json.dumps(cs['prototype']['readinessProbe'])
            self.assertIn('/health', health)
            self.assertNotIn('state', health)
            self.assertEqual(obj(items, 'Service', 'stf-ios-' + p['name'])['spec']['ports'],
                [{'name': 'screen', 'port': 17440, 'targetPort': 'screen'}])
        self.assertTrue(any(c['name'] == 'optional-adapter' for c in obj(items, 'Deployment', 'stf-ios-iphone-a')['spec']['template']['spec']['containers']))
        self.assertFalse(any(x['kind'] == 'PersistentVolumeClaim' and x['metadata']['name'] == 'stf-ios-iphone-a' for x in items))
        render({'ios': {'devices': [iphone()]}}, failure='ios.image')
        render({'ios': {'image': IOS_IMAGE, 'devices': [iphone(), iphone('b')]}}, failure='UDIDs must be unique')
        render({'ios': {'image': IOS_IMAGE, 'devices': [dict(iphone(), appiumMjpegPort=17440)]}},
               failure='appiumMjpegPort conflicts')

    def test_ingress_uses_public_origin_and_only_the_proxy(self):
        items = render({'publicOrigin': 'https://farm.example.com', 'proxy': {'ingress': {'enabled': True, 'className': 'custom'}}})
        ingress = next(x for x in items if x['kind'] == 'Ingress')['spec']
        self.assertEqual(ingress['rules'][0]['host'], 'farm.example.com')
        self.assertEqual(ingress['rules'][0]['http']['paths'][0]['backend']['service']['name'], 'stf-proxy')

    def test_configurable_http_and_separate_messaging_ports(self):
        values = {'ports': {'http': 3000}, 'messaging': {
            'app': {'pub': 7150, 'dealer': 7160, 'pull': 7170},
            'dev': {'pub': 7250, 'dealer': 7260, 'pull': 7270}},
            'proxy': {'containerPort': 8080, 'containerName': 'nginx',
                      'service': {'port': 8080}},
            'resourceNames': {'proxy-config': 'previous-screen-config'}}
        items = render(values)
        api = obj(items, 'Deployment', 'stf-api')['spec']['template']['spec']['containers'][0]
        self.assertIn({'name': 'PORT', 'value': '3000'}, api['env'])
        self.assertEqual(api['ports'], [{'name': 'http', 'containerPort': 3000}])
        self.assertIn('tcp://stf-triproxy-app:7150', api['command'])
        self.assertIn('tcp://stf-triproxy-app:7170', api['command'])
        self.assertIn('tcp://stf-triproxy-dev:7250', api['command'])
        self.assertIn('tcp://stf-triproxy-dev:7270', api['command'])
        for bus, expected in [('app', [7150, 7160, 7170]), ('dev', [7250, 7260, 7270])]:
            name = 'stf-triproxy-' + bus
            command = obj(items, 'Deployment', name)['spec']['template']['spec']['containers'][0]['command']
            for port in expected:
                self.assertIn('tcp://*:' + str(port), command)
            self.assertEqual([p['port'] for p in obj(items, 'Service', name)['spec']['ports']], expected)
        processor = obj(items, 'Deployment', 'stf-processor')['spec']['template']['spec']['containers'][0]
        self.assertIn('tcp://stf-triproxy-app:7160', processor['command'])
        self.assertIn('tcp://stf-triproxy-dev:7260', processor['command'])
        proxy = obj(items, 'Deployment', 'stf-proxy')['spec']['template']['spec']['containers'][0]
        self.assertEqual(proxy['name'], 'nginx')
        self.assertEqual(proxy['ports'], [{'name': 'http', 'containerPort': 8080}])
        self.assertEqual(obj(items, 'Service', 'stf-proxy')['spec']['ports'][0]['port'], 8080)
        config = obj(items, 'ConfigMap', 'previous-screen-config')['data']['nginx.conf']
        self.assertIn('listen 8080;', config)
        self.assertIn('server stf-api:3000;', config)
        first = next(x['metadata']['name'] for x in render() if x['kind'] == 'Job')
        changed = next(x['metadata']['name'] for x in items if x['kind'] == 'Job')
        self.assertNotEqual(first, changed)
        render({'messaging': {'app': {'pub': 7112}}}, failure='ports must be distinct')

    def test_exact_partial_android_pool_and_external_service(self):
        values = {'ports': {'http': 3000},
                  'messaging': {'dev': {'pub': 7250, 'dealer': 7260, 'pull': 7270}},
                  'android': {'providers': [{'name': 'a', 'containerName': 'previous-provider',
                      'minPort': 12010, 'maxPort': 12040, 'service': {'create': False},
                      'externalAdb': {'host': 'existing-adb'}}]}}
        items = render(values)
        self.assertFalse(any(x['kind'] == 'Service' and x['metadata']['name'] == 'stf-android-a' for x in items))
        container = obj(items, 'Deployment', 'stf-android-a')['spec']['template']['spec']['containers'][0]
        self.assertEqual(container['name'], 'previous-provider')
        self.assertIn('--max-port=12040', container['args'])
        self.assertIn('--connect-push=tcp://stf-triproxy-dev:7270', container['args'])
        self.assertIn('--storage-url=http://stf-proxy:7100/', container['args'])
        config = obj(items, 'ConfigMap', 'stf-proxy')['data']['nginx.conf']
        self.assertIn('/d/stf-android-a/12034/', config)
        self.assertNotIn('/d/stf-android-a/12038/', config)
        values['android']['providers'][0]['service']['create'] = True
        service = obj(render(values), 'Service', 'stf-android-a')['spec']
        self.assertEqual([p['port'] for p in service['ports']], list(range(12010, 12041)))
        values['android']['providers'][0]['maxPort'] = 12012
        render(values, failure='port pool')

    def test_disabled_migration_emits_no_api_access_or_bootstrap_job(self):
        phone = iphone()
        phone['service'] = {'create': False}
        values = {'migration': {'enabled': False},
                  'ios': {'image': IOS_IMAGE, 'devices': [phone]},
                  'android': {'providers': [{'name': 'a', 'externalAdb': {'host': 'existing-adb'}}]}}
        items = render(values)
        self.assertFalse(any(x['kind'] in ['Job', 'ServiceAccount', 'Role', 'RoleBinding'] for x in items))
        self.assertFalse(any(x['kind'] == 'Service' and x['metadata']['name'] == 'stf-ios-iphone-a' for x in items))
        for item in items:
            if item['kind'] != 'Deployment':
                continue
            pod = item['spec']['template']['spec']
            self.assertNotIn('serviceAccountName', pod)
            self.assertFalse(any(c['name'] == 'wait-migration' for c in pod.get('initContainers', [])))
            self.assertFalse(any(v['name'] == 'migration-identity' for v in pod.get('volumes', [])))
        ios = obj(items, 'Deployment', 'stf-ios-iphone-a')['spec']['template']['spec']
        self.assertEqual([c['name'] for c in ios['initContainers']], ['state'])

    def test_network_policy_isolates_every_release_pod_and_keeps_only_proxy_http_public(self):
        release = {'matchLabels': {'app.kubernetes.io/instance': 'stf'}}
        items = render()
        internal = obj(items, 'NetworkPolicy', 'stf-internal')['spec']
        self.assertEqual(internal['podSelector'], release)
        self.assertEqual(internal['policyTypes'], ['Ingress'])
        self.assertEqual(internal['ingress'], [{'from': [{'podSelector': release}]}])
        proxy = obj(items, 'NetworkPolicy', 'stf-proxy')['spec']
        self.assertEqual(proxy['podSelector'], {'matchLabels': {
            'app.kubernetes.io/instance': 'stf', 'app.kubernetes.io/component': 'proxy'}})
        self.assertEqual(proxy['policyTypes'], ['Ingress'])
        self.assertEqual(proxy['ingress'], [{'ports': [{'protocol': 'TCP', 'port': 'http'}]}])
        self.assertFalse(any(x['metadata']['name'] == 'stf-remote-providers' for x in items))
        with open(CHART / 'examples' / 'usb.yaml') as f:
            usb = yaml.safe_load(f)
        for scenario in (items, render(usb)):
            for x in scenario:
                if x['kind'] not in ('Deployment', 'StatefulSet', 'Job'):
                    continue
                labels = x['spec']['template']['metadata']['labels']
                role = 'migrate' if x['kind'] == 'Job' else x['metadata']['name'][4:]
                with self.subTest(kind=x['kind'], name=x['metadata']['name']):
                    self.assertEqual(labels['app.kubernetes.io/instance'], 'stf')
                    self.assertEqual(labels['app.kubernetes.io/component'], role)

    def test_network_policy_restricted_proxy_still_accepts_own_providers(self):
        release = {'podSelector': {'matchLabels': {'app.kubernetes.io/instance': 'stf'}}}
        ingress = {'namespaceSelector': {'matchLabels': {'kubernetes.io/metadata.name': 'ingress-nginx'}}}
        floor2 = {'namespaceSelector': {'matchLabels': {'kubernetes.io/metadata.name': 'stf-floor2'}}}
        items = render({'networkPolicy': {'proxyFrom': [ingress], 'remoteProvidersFrom': [floor2]},
                        'messaging': {'dev': {'pub': 7250, 'dealer': 7260, 'pull': 7270}},
                        'android': {'providers': [{'name': 'a', 'externalAdb': {'host': 'adb'}}]}})
        self.assertEqual(obj(items, 'NetworkPolicy', 'stf-proxy')['spec']['ingress'], [{
            'ports': [{'protocol': 'TCP', 'port': 'http'}], 'from': [release, ingress]}])
        self.assertEqual(obj(items, 'NetworkPolicy', 'stf-internal')['spec']['ingress'], [{'from': [release]}])
        provider = obj(items, 'Deployment', 'stf-android-a')['spec']['template']['spec']['containers'][0]
        self.assertIn('--storage-url=http://stf-proxy:7100/', provider['args'])
        remote = obj(items, 'NetworkPolicy', 'stf-remote-providers')['spec']
        self.assertEqual(remote['podSelector'], {'matchLabels': {
            'app.kubernetes.io/instance': 'stf', 'app.kubernetes.io/component': 'triproxy-dev'}})
        self.assertEqual(remote['policyTypes'], ['Ingress'])
        self.assertEqual(remote['ingress'], [{'ports': [{'protocol': 'TCP', 'port': 'pub'},
                                                      {'protocol': 'TCP', 'port': 'pull'}],
                                             'from': [floor2]}])
        bus = obj(items, 'Deployment', 'stf-triproxy-dev')['spec']['template']['spec']['containers'][0]
        self.assertEqual(bus['ports'], [{'name': 'pub', 'containerPort': 7250},
                                       {'name': 'dealer', 'containerPort': 7260},
                                       {'name': 'pull', 'containerPort': 7270}])

    def test_network_labels_preserve_legacy_selectors_for_adoption(self):
        roles = ['api', 'proxy', 'triproxy-dev', 'rethinkdb', 'android-a', 'adb-a', 'ios-iphone-a', 'migrate']
        overrides = {role: {'app': 'previous-' + role} for role in roles}
        values = {'fullnameOverride': 'custom', 'selectorOverrides': overrides,
                  'resourceNames': {'api': 'previous-api'},
                  'android': {'providers': [{'name': 'a', 'nodeSelector': {'kubernetes.io/hostname': 'usb-a'}}]},
                  'ios': {'image': IOS_IMAGE, 'devices': [iphone()]}}
        items = render(values, namespace='another-ns', release='custom-release')
        for role in roles:
            name = 'previous-api' if role == 'api' else 'custom-' + role
            kind = 'StatefulSet' if role == 'rethinkdb' else 'Deployment'
            item = next(x for x in items if x['kind'] == 'Job') if role == 'migrate' else obj(items, kind, name)
            spec = item['spec']
            with self.subTest(role=role):
                self.assertEqual(spec['template']['metadata']['labels'], {
                    **overrides[role], 'app.kubernetes.io/instance': 'custom-release',
                    'app.kubernetes.io/component': role})
                if role != 'migrate':
                    self.assertEqual(spec['selector']['matchLabels'], overrides[role])
                if role not in ('migrate',):
                    self.assertEqual(obj(items, 'Service', name)['spec']['selector'], overrides[role])
        self.assertEqual(obj(items, 'NetworkPolicy', 'custom-internal')['spec']['podSelector'], {
            'matchLabels': {'app.kubernetes.io/instance': 'custom-release'}})
        self.assertEqual(obj(items, 'NetworkPolicy', 'custom-proxy')['spec']['podSelector'], {'matchLabels': {
            'app.kubernetes.io/instance': 'custom-release', 'app.kubernetes.io/component': 'proxy'}})
        binding = next(x for x in items if x['kind'] == 'RoleBinding')
        self.assertEqual(binding['subjects'][0]['namespace'], 'another-ns')

    def test_broad_legacy_selectors_cannot_broaden_network_policy_targets(self):
        release = {'app.kubernetes.io/instance': 'stf'}
        peer = {'namespaceSelector': {'matchLabels': {'kubernetes.io/metadata.name': 'remote'}}}
        items = render({'selectorOverrides': {'proxy': release, 'triproxy-dev': release},
                        'networkPolicy': {'remoteProvidersFrom': [peer]}})
        for policy, role in [('stf-proxy', 'proxy'), ('stf-remote-providers', 'triproxy-dev')]:
            with self.subTest(policy=policy):
                selector = obj(items, 'NetworkPolicy', policy)['spec']['podSelector']['matchLabels']
                self.assertEqual(selector, {**release, 'app.kubernetes.io/component': role})
                api_labels = obj(items, 'Deployment', 'stf-api')['spec']['template']['metadata']['labels']
                self.assertFalse(all(api_labels.get(k) == v for k, v in selector.items()))

    def test_conflicting_network_identity_labels_fail_before_install(self):
        for role, labels in [('api', {'app.kubernetes.io/component': 'proxy'}),
                             ('proxy', {'app.kubernetes.io/component': 'api'}),
                             ('triproxy-dev', {'app.kubernetes.io/component': 'proxy'}),
                             ('api', {'app.kubernetes.io/instance': 'another-release'}),
                             ('migrate', {'app.kubernetes.io/instance': 'another-release'})]:
            with self.subTest(role=role, labels=labels):
                render({'selectorOverrides': {role: labels}}, failure='selectorOverrides')
        render({'selectorOverrides': {'api': {'app.kubernetes.io/instance': 'stf',
                                             'app.kubernetes.io/component': 'api', 'app': 'previous-api'}}})

    def test_disabled_network_policy_preserves_old_template_labels(self):
        overrides = {'api': {'app': 'previous-api'},
                     'proxy': {'app.kubernetes.io/instance': 'old-release'},
                     'migrate': {'app': 'previous-migrate'}}
        items = render({'selectorOverrides': overrides, 'networkPolicy': {'enabled': False}})
        self.assertFalse(any(x['kind'] == 'NetworkPolicy' for x in items))
        for role in ['api', 'proxy']:
            spec = obj(items, 'Deployment', 'stf-' + role)['spec']
            self.assertEqual(spec['selector']['matchLabels'], overrides[role])
            self.assertEqual(spec['template']['metadata']['labels'], overrides[role])
        job = next(x for x in items if x['kind'] == 'Job')
        self.assertEqual(job['spec']['template']['metadata']['labels'], overrides['migrate'])

    def test_network_policy_accepts_selector_and_ip_peers(self):
        peers = [{'podSelector': {}}, {'namespaceSelector': {}},
                 {'namespaceSelector': {'matchLabels': {'environment': 'test'}},
                  'podSelector': {'matchExpressions': [
                      {'key': 'role', 'operator': 'In', 'values': ['provider']},
                      {'key': 'blocked', 'operator': 'NotIn', 'values': ['true']},
                      {'key': 'approved', 'operator': 'Exists'},
                      {'key': 'quarantine', 'operator': 'DoesNotExist', 'values': []}]}},
                 {'ipBlock': {'cidr': '192.0.2.0/24', 'except': ['192.0.2.128/25']}},
                 {'ipBlock': {'cidr': '2001:db8::/32'}}]
        items = render({'networkPolicy': {'proxyFrom': peers, 'remoteProvidersFrom': peers}})
        self.assertEqual(obj(items, 'NetworkPolicy', 'stf-proxy')['spec']['ingress'][0]['from'][1:], peers)
        self.assertEqual(obj(items, 'NetworkPolicy', 'stf-remote-providers')['spec']['ingress'][0]['from'], peers)

    def test_invalid_network_policy_peers_fail_schema_validation(self):
        invalid = [{}, {'unknown': {}}, {'podSelector': {'unknown': True}},
                   {'namespaceSelector': {'matchLabels': {'role': 1}}},
                   {'ipBlock': {'cidr': '192.0.2.0/24'}, 'podSelector': {}},
                   {'ipBlock': {'cidr': '192.0.2.0/24'}, 'namespaceSelector': {}},
                   {'ipBlock': {}}, {'ipBlock': {'cidr': '192.0.2.0/24', 'except': [7]}},
                   {'podSelector': {'matchExpressions': [{}]}},
                   {'podSelector': {'matchExpressions': [{'key': 'role'}]}},
                   {'podSelector': {'matchExpressions': [{'key': 'role', 'operator': 'Unknown'}]}},
                   {'podSelector': {'matchExpressions': [{'key': 'role', 'operator': 'In'}]}},
                   {'podSelector': {'matchExpressions': [{'key': 'role', 'operator': 'NotIn', 'values': []}]}},
                   {'namespaceSelector': {'matchExpressions': [{'key': 'role', 'operator': 'Exists', 'values': ['x']}]}},
                   {'namespaceSelector': {'matchExpressions': [{'key': 'role', 'operator': 'DoesNotExist', 'values': ['x']}]}},
                   {'namespaceSelector': {'matchExpressions': [{'key': 'role', 'operator': 'Exists', 'unknown': True}]}}]
        for setting in ['proxyFrom', 'remoteProvidersFrom', 'coordinatorFrom']:
            for peer in invalid:
                with self.subTest(setting=setting, peer=peer):
                    render({'networkPolicy': {setting: [peer]}}, failure=setting)

    def test_public_usb_example_uses_oauth_and_confines_its_secret_to_auth(self):
        with open(CHART / 'examples' / 'usb.yaml') as f:
            values = yaml.safe_load(f)
        self.assertTrue(values['proxy']['ingress']['enabled'])
        self.assertEqual(values['auth']['type'], 'oauth2')
        self.assertEqual(values['auth']['existingSecret'], 'stf-oauth')
        items = render(values)
        auth = obj(items, 'Deployment', 'stf-auth')['spec']['template']['spec']['containers'][0]
        self.assertEqual(auth['command'], ['stf', 'auth-oauth2', '--app-url', values['publicOrigin'] + '/'])
        self.assertEqual(auth['envFrom'], [{'secretRef': {'name': 'stf-oauth'}}])
        auth_env = {e['name']: e.get('value') for e in auth['env']}
        self.assertEqual(auth_env['STF_AUTH_OAUTH2_OAUTH_CALLBACK_URL'],
                         values['publicOrigin'] + '/auth/oauth/callback')
        for key, value in values['auth']['env'].items():
            self.assertEqual(auth_env[key], value)
        self.assertNotIn('STF_AUTH_OAUTH2_OAUTH_CLIENT_ID', auth_env)
        self.assertNotIn('STF_AUTH_OAUTH2_OAUTH_CLIENT_SECRET', auth_env)
        app = obj(items, 'Deployment', 'stf-app')['spec']['template']['spec']['containers'][0]
        self.assertIn(values['publicOrigin'] + '/auth/oauth/', app['command'])
        self.assertFalse(any(x['kind'] == 'Secret' for x in items))
        for item in items:
            if item['kind'] not in ('Deployment', 'StatefulSet', 'Job'):
                continue
            for container in item['spec']['template']['spec']['containers']:
                if item['metadata']['name'] == 'stf-auth':
                    continue
                self.assertNotIn('stf-oauth', json.dumps(container))
                self.assertFalse(any(e['name'].startswith('STF_AUTH_OAUTH2_') for e in container.get('env', [])))

    def test_external_iphone_routes_are_explicit_screen_only_routes(self):
        route = {'path': '/d/existing-iphone-screen/17440/',
                 'service': 'existing-iphone-screen', 'port': 17440}
        items = render({'proxy': {'extraScreenRoutes': [route]}})
        config = obj(items, 'ConfigMap', 'stf-proxy')['data']['nginx.conf']
        self.assertIn('location = /d/existing-iphone-screen/17440/ { proxy_pass http://existing-iphone-screen:17440/; }', config)
        self.assertFalse(any(x['kind'] == 'Deployment' and 'ios-' in x['metadata']['name'] for x in items))
        render({'proxy': {'extraScreenRoutes': [route, route]}}, failure='paths must be unique')
        for invalid in [{'path': '/d/existing-iphone-screen/8100/', 'service': route['service'], 'port': 8100},
                        {**route, 'service': 'http://outside.example'}, {**route, 'path': '/api/v1/'}]:
            render({'proxy': {'extraScreenRoutes': [invalid]}}, failure='extraScreenRoutes')


if __name__ == '__main__': unittest.main()
