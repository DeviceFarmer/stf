#!/usr/bin/env python3
"""Install and upgrade the chart in an owned Kind cluster, without a browser or USB.

Requires helm, kind, kubectl and a running Docker Engine. All Kubernetes commands
use the new cluster's explicit kubeconfig; an existing cluster is never reused.
"""

import argparse
import base64
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


CHART = Path(__file__).resolve().parents[1]


class SmokeError(Exception):
    pass


class Smoke:
    def __init__(self, args):
        self.args = args
        self.artifacts = Path(args.artifacts).resolve()
        self.artifacts.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.kubeconfig = Path(args.kubeconfig).resolve()
        if self.kubeconfig.is_relative_to(self.artifacts):
            raise SmokeError('Keep the private kubeconfig outside uploaded artifacts')
        self.env = {**os.environ, 'KUBECONFIG': str(self.kubeconfig)}
        self.context = 'kind-' + args.cluster_name
        self.owned = False
        self.forward = None
        self.forward_log = None
        self.stage = 'initialization'
        self.secret = secrets.token_hex(32)
        self.checks = []
        self.admin_email = 'chart-admin@example.test'
        self.admin_name = 'Chart administrator'
        self.jar = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.anonymous = urllib.request.build_opener()
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0))
            self.port = s.getsockname()[1]
        self.origin = 'http://127.0.0.1:' + str(self.port)

    def redact(self, text):
        text = text.replace(self.secret, '[REDACTED]')
        text = text.replace(base64.b64encode(self.secret.encode()).decode(), '[REDACTED]')
        text = re.sub(r'([?&]jwt=)[^\s"&]+', r'\1[REDACTED]', text)
        text = re.sub(r'(?i)(Bearer\s+)[A-Za-z0-9._-]+', r'\1[REDACTED]', text)
        text = re.sub(r'(?i)((?:set-)?cookie:)[^\r\n]*', r'\1 [REDACTED]', text)
        text = re.sub(r'\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[REDACTED JWT]', text)
        return text

    def command(self, args, *, data=None, timeout=120, check=True):
        result = subprocess.run(args, input=data, capture_output=True, text=True,
                                env=self.env, timeout=timeout)
        with (self.artifacts / 'commands.log').open('a') as log:
            log.write('$ ' + shlex.join(map(str, args)) + '\n')
            log.write(self.redact(result.stdout + result.stderr) + '\n')
        if check and result.returncode:
            raise SmokeError('Command failed: ' + args[0] + ' (see sanitized commands.log)')
        return result

    def kubectl(self, *args, **kwargs):
        return self.command([self.args.kubectl, '--kubeconfig', str(self.kubeconfig),
                             '--context', self.context, '-n', 'stf-smoke', *args], **kwargs)

    def step(self, text):
        self.stage = text
        print(text, flush=True)

    def http(self, path, *, client=None, data=None, headers=None):
        request = urllib.request.Request(self.origin + path, data=data,
                                         headers=headers or {})
        try:
            with (client or self.client).open(request, timeout=15) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            return error.code, error.read()

    @staticmethod
    def require(condition, message):
        if not condition:
            raise SmokeError(message)

    def request_json(self, path, *, client=None):
        status, body = self.http(path, client=client,
                                 headers={'Accept': 'application/json'})
        self.require(status == 200, 'Unexpected API status')
        return json.loads(body)

    def wait_http(self, path='/healthz', *, client=None, seconds=90):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if self.forward and self.forward.poll() is not None:
                raise SmokeError('Port-forward exited')
            try:
                status, body = self.http(path, client=client)
                if status == 200:
                    return body
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(1)
        raise SmokeError('HTTP readiness timed out')

    def start_forward(self):
        self.forward_log = tempfile.TemporaryFile(mode='w+')
        self.forward = subprocess.Popen([
            self.args.kubectl, '--kubeconfig', str(self.kubeconfig), '--context',
            self.context, '-n', 'stf-smoke', 'port-forward', '--address', '127.0.0.1',
            'service/stf-proxy', str(self.port) + ':7100'], env=self.env,
            stdout=self.forward_log, stderr=subprocess.STDOUT, text=True)
        self.wait_http()

    def stop_forward(self):
        if self.forward:
            self.forward.terminate()
            try:
                self.forward.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.forward.kill()
                self.forward.wait(timeout=5)
            self.forward = None
        if self.forward_log:
            self.forward_log.seek(0)
            with (self.artifacts / 'port-forward.log').open('a') as out:
                out.write(self.redact(self.forward_log.read()))
            self.forward_log.close()
            self.forward_log = None

    def install(self, revision):
        values = {'session': {'existingSecret': 'stf-session'},
                  'publicOrigin': self.origin,
                  'database': {'persistence': {'enabled': True}},
                  'migration': {'revision': revision}}
        if revision == 'fresh':
            values['bootstrap'] = {'adminName': self.admin_name, 'adminEmail': self.admin_email}
        if self.args.image:
            repository, separator, tag = self.args.image.rpartition(':')
            self.require(bool(separator and repository and tag), '--image requires repository:tag')
            values['image'] = {'repository': repository, 'tag': tag, 'digest': ''}
        path = self.artifacts / 'values.json'
        path.write_text(json.dumps(values, indent=2) + '\n')
        self.command([self.args.helm, 'upgrade', '--install', 'stf', str(CHART),
                      '--kubeconfig', str(self.kubeconfig), '--kube-context', self.context,
                      '--namespace', 'stf-smoke', '--values', str(path), '--wait',
                      '--timeout', '10m'], timeout=660)
        jobs = json.loads(self.kubectl('get', 'jobs', '-l',
            'app.kubernetes.io/instance=stf', '-o', 'json').stdout)['items']
        self.require(len(jobs) == 1, 'Expected exactly one current migration Job')
        job = jobs[0]
        self.require(any(c['type'] == 'Complete' and c['status'] == 'True'
                         for c in job.get('status', {}).get('conditions', [])),
                     'Migration Job did not complete')
        return job['metadata']['name']

    def uid(self, resource, name):
        return self.kubectl('get', resource, name, '-o',
                            'jsonpath={.metadata.uid}').stdout.strip()

    def login(self):
        self.wait_http('/auth/mock/')
        csrf = next((c.value for c in self.jar if c.name == 'XSRF-TOKEN'), None)
        self.require(bool(csrf), 'Auth service did not issue a CSRF cookie')
        email = 'chart-' + secrets.token_hex(8) + '@ci.example'
        name = 'Chart persistence marker'
        status, body = self.http('/auth/api/v1/mock',
            data=json.dumps({'email': email, 'name': name}).encode(),
            headers={'Accept': 'application/json', 'Content-Type': 'application/json',
                     'X-XSRF-TOKEN': urllib.parse.unquote(csrf)})
        self.require(status == 200, 'Mock login failed')
        result = json.loads(body)
        self.require(result.get('success') is True, 'Mock login was rejected')
        redirect = urllib.parse.urlsplit(result.get('redirect', ''))
        self.require(redirect.scheme + '://' + redirect.netloc == self.origin,
                     'Login redirect left the configured origin')
        self.require(bool(urllib.parse.parse_qs(redirect.query).get('jwt')),
                     'Login did not return its JWT redirect')
        status, _ = self.http(urllib.parse.urlunsplit(('', '', redirect.path or '/',
                                                       redirect.query, '')))
        self.require(status == 200, 'App did not exchange the login token for a session')
        user = self.request_json('/api/v1/user')
        self.require(user.get('success') is True and user.get('user', {}).get('email') == email,
                     'Authenticated user does not match the new database marker')
        return email

    def verify_owner(self):
        # Auth and API restart independently after a database outage.
        contact = json.loads(self.wait_http('/auth/contact', client=self.anonymous,
                                            seconds=120)).get('contact', {})
        self.require(contact.get('email') == self.admin_email and contact.get('name') == self.admin_name,
                     'Migration changed the existing bootstrap owner')

    def verify_session(self, email):
        user = json.loads(self.wait_http('/api/v1/user', seconds=120))
        self.require(user.get('success') is True and user.get('user', {}).get('email') == email,
                     'Existing cookie or persisted user was lost')
        devices = self.request_json('/api/v1/devices')
        self.require(devices.get('success') is True and devices.get('devices') == [],
                     'Expected an authenticated empty device list without USB providers')
        self.require(self.http('/api/v1/devices', client=self.anonymous)[0] == 401,
                     'Unauthenticated device access was not rejected')

    def collect(self):
        if not self.owned:
            return
        try:
            result = self.kubectl('get', 'deployments,statefulsets,pods,jobs,pvc,services,events',
                                  '-o', 'json', check=False, timeout=30)
            (self.artifacts / 'resources.json').write_text(self.redact(result.stdout))
            pods = json.loads(self.kubectl('get', 'pods', '-o', 'json',
                                          check=False, timeout=30).stdout).get('items', [])
            for pod in pods:
                name = pod['metadata']['name']
                for container in pod['spec'].get('containers', []) + pod['spec'].get('initContainers', []):
                    result = self.kubectl('logs', name, '-c', container['name'],
                                          '--tail=120', check=False, timeout=15)
                    (self.artifacts / (name + '-' + container['name'] + '.log')).write_text(
                        self.redact(result.stdout + result.stderr))
        except Exception:
            print('Some diagnostic logs were unavailable', file=sys.stderr)

    def run(self):
        self.require(re.fullmatch(r'stf-chart-[a-z0-9-]{1,35}', self.args.cluster_name),
                     'Cluster name must start with stf-chart-')
        self.require(not self.kubeconfig.exists() and not self.kubeconfig.is_symlink(),
                     'Use a new temporary kubeconfig path')
        clusters = self.command([self.args.kind, 'get', 'clusters']).stdout.splitlines()
        self.require(self.args.cluster_name not in clusters,
                     'Refusing to reuse an existing Kind cluster')
        self.kubeconfig.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.step('Create an isolated Kind cluster')
            self.owned = True
            self.command([self.args.kind, 'create', 'cluster', '--name', self.args.cluster_name,
                          '--kubeconfig', str(self.kubeconfig), '--wait', '3m'], timeout=240)
            self.kubeconfig.chmod(0o600)
            self.kubectl('create', 'namespace', 'stf-smoke')
            secret = {'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': 'stf-session'},
                      'stringData': {'SECRET': self.secret}}
            self.kubectl('create', '-f', '-', data=json.dumps(secret))

            self.step('Install the core chart and wait for migration')
            first_job = self.install('fresh')
            secret_uid = self.uid('secret', 'stf-session')
            pvc_uid = self.uid('pvc', 'stf-rethinkdb')
            self.require(bool(secret_uid and pvc_uid), 'Persistent resource identity was missing')
            self.start_forward()
            self.require(self.http('/api/v1/user', client=self.anonymous)[0] == 401,
                         'Anonymous API requests must return 401')
            email = self.login()
            self.verify_session(email)
            self.verify_owner()
            self.checks += ['fresh_install', 'migration', 'mock_login', 'cookie_session',
                            'authenticated_devices', 'anonymous_401']

            self.step('Upgrade the chart and preserve the existing session and database')
            self.stop_forward()
            second_job = self.install('upgrade')
            self.require(first_job != second_job, 'Upgrade did not create a new migration Job')
            self.require(self.uid('secret', 'stf-session') == secret_uid, 'Session Secret was replaced')
            self.require(self.uid('pvc', 'stf-rethinkdb') == pvc_uid, 'Database PVC was replaced')
            self.start_forward()
            self.verify_session(email)
            self.verify_owner()
            self.checks += ['bootstrap_owner_after_upgrade', 'upgrade_migration', 'same_secret_uid', 'same_pvc_uid',
                            'session_after_upgrade', 'user_after_upgrade']

            self.step('Replace the database pod and check persisted user with the same cookie')
            old_pod_uid = self.uid('pod', 'stf-rethinkdb-0')
            self.kubectl('rollout', 'restart', 'statefulset/stf-rethinkdb')
            self.kubectl('rollout', 'status', 'statefulset/stf-rethinkdb', '--timeout=180s', timeout=190)
            self.require(self.uid('pod', 'stf-rethinkdb-0') != old_pod_uid,
                         'Database pod was not replaced')
            self.verify_session(email)
            self.verify_owner()
            self.require(self.uid('pvc', 'stf-rethinkdb') == pvc_uid, 'Database restart replaced its PVC')
            self.checks += ['database_pod_replaced', 'user_after_database_restart',
                            'bootstrap_owner_after_database_restart']
            (self.artifacts / 'result.json').write_text(json.dumps(
                {'status': 'pass', 'checks': self.checks, 'hardware': False, 'browser': False}, indent=2) + '\n')
            print('PASS: ' + str(len(self.checks)) + ' core lifecycle checks', flush=True)
        finally:
            self.stop_forward()
            self.collect()
            try:
                if self.owned:
                    cleanup = self.command([self.args.kind, 'delete', 'cluster', '--name', self.args.cluster_name,
                                            '--kubeconfig', str(self.kubeconfig)], timeout=120, check=False)
                    if cleanup.returncode:
                        raise SmokeError('Isolated Kind cluster cleanup failed')
            finally:
                self.kubeconfig.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cluster-name', default='stf-chart-ci-smoke')
    parser.add_argument('--kubeconfig', required=True, help='New temporary file; never your farm kubeconfig')
    parser.add_argument('--artifacts', default='test-results/kubernetes')
    parser.add_argument('--helm', default=os.environ.get('HELM', 'helm'))
    parser.add_argument('--kind', default=os.environ.get('KIND', 'kind'))
    parser.add_argument('--kubectl', default='kubectl')
    parser.add_argument('--image', help='Optional real STF image repository:tag for local builds')
    args = parser.parse_args()
    smoke = Smoke(args)
    try:
        smoke.run()
    except Exception as error:
        # HTTP exceptions can contain a JWT redirect URL. Never print exception bodies.
        reason = smoke.redact(str(error)) if isinstance(error, SmokeError) else type(error).__name__
        print(smoke.stage + ' failed: ' + reason, file=sys.stderr)
        (smoke.artifacts / 'result.json').write_text(json.dumps(
            {'status': 'fail', 'stage': smoke.stage, 'checks': smoke.checks,
             'error': reason}, indent=2) + '\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
