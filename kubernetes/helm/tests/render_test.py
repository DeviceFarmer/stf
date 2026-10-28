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

    def test_missing_secret_and_invalid_origin_fail_without_cluster(self):
        render({'session': {'existingSecret': ''}}, failure='existingSecret')
        render({'publicOrigin': 'https://stf.example.com/path'}, failure='publicOrigin')

    def test_nondefault_namespace_and_resource_identity_overrides(self):
        values = {'fullnameOverride': 'custom', 'resourceNames': {'api': 'previous-api'},
                  'selectorOverrides': {'api': {'app': 'previous-api'}}}
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
                  {'selectorOverrides': {'migrate': {'app': 'previous-migrate'}}}]:
            self.assertNotEqual(name(), name(v))

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
        items = render({'ios': {'image': IOS_IMAGE, 'devices': phones}})
        for p in phones:
            pod = obj(items, 'Deployment', 'stf-ios-' + p['name'])['spec']['template']['spec']
            cs = {c['name']: c for c in pod['containers']}
            self.assertTrue(cs['tunnel']['securityContext']['privileged'])
            self.assertFalse(cs['prototype']['securityContext']['allowPrivilegeEscalation'])
            health = json.dumps(cs['prototype']['readinessProbe'])
            self.assertIn('/health', health)
            self.assertNotIn('state', health)
            self.assertEqual(obj(items, 'Service', 'stf-ios-' + p['name'])['spec']['ports'],
                [{'name': 'screen', 'port': 17440, 'targetPort': 'screen'}])
        self.assertTrue(any(c['name'] == 'optional-adapter' for c in obj(items, 'Deployment', 'stf-ios-iphone-a')['spec']['template']['spec']['containers']))
        self.assertFalse(any(x['kind'] == 'PersistentVolumeClaim' and x['metadata']['name'] == 'stf-ios-iphone-a' for x in items))
        render({'ios': {'devices': [iphone()]}}, failure='ios.image')
        render({'ios': {'image': IOS_IMAGE, 'devices': [iphone(), iphone('b')]}}, failure='UDIDs must be unique')

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
