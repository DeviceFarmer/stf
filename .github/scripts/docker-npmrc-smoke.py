#!/usr/bin/env python3
"""Check the production Dockerfile's optional npmrc secret using a built image.

The fixtures reuse the real USER, COPY and npm RUN instructions. Only the npm
install/prune/pack commands become registry probes, so no registry or native
compilation is needed. Every dependency-stage layer is scanned for fake secrets.
"""

import argparse
import gzip
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import uuid


PROBE = r"""const assert = require('node:assert/strict')
const fs = require('node:fs')
const cp = require('node:child_process')
const os = require('node:os')
const path = require('node:path')
const root = '/build/.npmrc-smoke'
const expected = JSON.parse(fs.readFileSync(path.join(root, 'expected.json')))
const secret = '/run/secrets/npmrc'
const phase = process.argv[2]
assert.equal(process.versions.node.split('.')[0], '22', 'Expected Node.js 22')
assert.equal(process.getuid(), expected.uid, 'Unexpected npm user ID')
assert.equal(process.getgid(), expected.uid, 'Unexpected npm group ID')
assert.equal(fs.existsSync('/build/.npmrc'), false, 'Context .npmrc reached COPY')
if (phase === 'after') {
  assert.equal(fs.existsSync(secret), false, 'Secret survived its RUN instruction')
  assert.equal(Object.hasOwn(process.env, 'NPM_CONFIG_USERCONFIG'), false,
    'Secret configuration survived its RUN instruction')
  assert.equal(fs.readFileSync(path.join(root, process.argv[3] + '.ok'), 'utf8'), 'ok\n')
  process.exit(0)
}
assert.equal(fs.existsSync(secret), expected.secret, 'Optional secret mount is incorrect')
let registry = 'https://registry.npmjs.org/'
if (expected.secret) {
  assert.equal(fs.statSync(secret).mode & 0o777, 0o444, 'Secret must be mode 0444')
  const match = fs.readFileSync(secret, 'utf8').match(/^registry=(.+)$/m)
  assert(match, 'Synthetic secret has no registry setting')
  registry = match[1]
  assert.equal(process.env.NPM_CONFIG_USERCONFIG, secret, 'npm userconfig is not set')
}
else {
  assert.equal(Object.hasOwn(process.env, 'NPM_CONFIG_USERCONFIG'), false,
    'An omitted secret must keep npm defaults')
}
let configured
try {
  configured = cp.execFileSync('npm', ['config', 'get', 'registry'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, NPM_CONFIG_UPDATE_NOTIFIER: 'false'}
  }).trim()
}
catch {
  throw new Error('npm could not read its configuration')
}
// Never include registry or token values in assertion output.
assert(configured === registry, 'npm did not use the expected registry')
fs.writeFileSync(path.join(root, phase + '.ok'), 'ok\n')
if (phase === 'pack') {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'npmrc-pack-'))
  try {
    fs.mkdirSync(path.join(temporary, 'package'))
    fs.writeFileSync(path.join(temporary, 'package', 'LICENSE'), 'Smoke fixture\n')
    cp.execFileSync('tar', ['-czf', '/build/npmrc-smoke-package.tgz', '-C', temporary, 'package'],
      {stdio: ['ignore', 'ignore', 'pipe']})
  }
  finally {
    fs.rmSync(temporary, {recursive: true, force: true})
  }
  console.log('npmrc-smoke-package.tgz')
}
"""


def instructions(source):
    """Retain real instruction text, including shell continuations and mounts."""
    pending = []
    for line in source.splitlines():
        if not pending and (not line.strip() or line.lstrip().startswith('#')):
            continue
        pending.append(line)
        if line.rstrip().endswith('\\'):
            continue
        yield '\n'.join(pending)
        pending = []
    if pending:
        raise ValueError('Unterminated Dockerfile instruction')


def fixture_dockerfile(source, base, uid):
    stages = {}
    current = None
    for instruction in instructions(source):
        if instruction.upper().startswith('FROM '):
            match = re.search(r'\sAS\s+(\S+)\s*$', instruction, re.IGNORECASE)
            current = match[1].lower() if match else None
            if current:
                if current in stages:
                    raise ValueError('Duplicate Dockerfile stage: ' + current)
                stages[current] = []
        elif current:
            stages[current].append(instruction)

    result = [
        '# syntax=docker/dockerfile:1',
        'FROM ' + base + ' AS node-base',
        'USER root',
        # Exercise both production UIDs on the native image, without emulation.
        'RUN if [ "$(id -u stf)" != "' + str(uid) + '" ]; then '
        'usermod -u ' + str(uid) + ' stf; groupmod -g ' + str(uid) + ' stf; fi',
    ]
    for stage, phase in [('dependencies', 'install'),
                         ('production-dependencies', 'prune'), ('build', 'pack')]:
        body = stages.get(stage)
        if body is None:
            raise ValueError('Missing Dockerfile stage: ' + stage)
        if stage == 'dependencies':
            # The existing runtime image supplies Node. Skip only tool installation.
            start = next((i for i, item in enumerate(body)
                          if re.match(r'WORKDIR\s+/build\s*$', item, re.I)), None)
            if start is None:
                raise ValueError('Expected dependencies WORKDIR /build')
            body = body[start:]
        result.append('FROM ' + ('node-base' if stage == 'dependencies' else 'dependencies')
                      + ' AS ' + stage)
        count = 0
        for instruction in body:
            if re.match(r'RUN\s', instruction, re.I):
                # Replace the command and its simple flags, preserving mounts,
                # conditional exports, redirection and the rest of the real RUN.
                pattern = r'\bnpm\s+' + phase + r'\b(?:[ \t]+--[A-Za-z0-9_=-]+)*'
                rewritten, replacements = re.subn(
                    pattern, 'node /build/.npmrc-smoke/probe.cjs ' + phase, instruction)
                if replacements:
                    count += replacements
                    if phase == 'install':
                        result.append('COPY --chown=stf:stf .npmrc-smoke /build/.npmrc-smoke')
                    result.append(rewritten)
                    result.append('RUN node /build/.npmrc-smoke/probe.cjs after ' + phase)
                    continue
            result.append(instruction)
        if count != 1:
            raise ValueError('Expected exactly one npm ' + phase + ' command')
    return '\n\n'.join(result) + '\n'


def run(command, markers=(), **options):
    completed = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                               text=True, **options)
    if completed.returncode:
        output = completed.stdout
        for marker in markers:
            output = output.replace(marker.decode(), '[synthetic secret redacted]')
        raise RuntimeError('Command failed: ' + ' '.join(command[:3]) + '\n'
                           + '\n'.join(output.splitlines()[-45:]))
    return completed.stdout


def scan_stream(stream, markers):
    found, overlap = set(), b''
    while True:
        chunk = stream.read(1024 * 1024)
        if not chunk:
            return found
        data = overlap + chunk
        found.update(i for i, marker in enumerate(markers) if marker in data)
        overlap = data[-(max(map(len, markers)) - 1):]


def scan_saved_layers(tags, markers):
    """Scan complete decoded layer payloads and image config/history."""
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(['docker', 'image', 'save', *tags],
                                   stdout=subprocess.PIPE, stderr=errors)
        found = []
        try:
            with tarfile.open(fileobj=process.stdout, mode='r|*') as archive:
                for member in archive:
                    if not member.isfile():
                        continue
                    with archive.extractfile(member) as payload:
                        magic = payload.peek(4)[:4]
                        if magic[:2] == b'\x1f\x8b':
                            with gzip.GzipFile(fileobj=payload) as decoded:
                                kinds = scan_stream(decoded, markers)
                        elif magic == b'\x28\xb5\x2f\xfd':
                            raise RuntimeError('Cannot scan a zstd layer; export uncompressed or gzip layers')
                        else:
                            kinds = scan_stream(payload, markers)
                        if kinds:
                            found.append((member.name, kinds))
            status = process.wait()
        finally:
            process.stdout.close()
            if process.poll() is None:
                process.terminate()
                process.wait()
        if status:
            raise RuntimeError('Could not export fixture image layers')
        if found:
            names = ('context config', 'secret registry', 'secret token')
            details = '; '.join(name + ' (' + ', '.join(names[i] for i in sorted(kinds)) + ')'
                                for name, kinds in found)
            raise RuntimeError('Synthetic npmrc retained in exported member: ' + details)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True, help='Already-built local runtime image')
    parser.add_argument('--dockerfile', type=Path, default=None, help='Dockerfile to exercise (default: repository Dockerfile)')
    parser.add_argument('--platform', required=True, choices=['linux/amd64', 'linux/arm64'])
    parser.add_argument('--output', type=Path, help='Write a JSON check report')
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    source = (args.dockerfile or repository / 'Dockerfile').read_text()
    ignore = repository / '.dockerignore'
    image = json.loads(run(['docker', 'image', 'inspect', args.image]))[0]
    if image['Os'] + '/' + image['Architecture'] != args.platform:
        raise ValueError('The existing image must match --platform')

    identifier = uuid.uuid4().hex
    prefix = 'stf-npmrc-smoke-' + identifier
    base = prefix + ':base'
    context_marker = ('context-npmrc-' + identifier).encode()
    secret_marker = ('secret-npmrc-' + identifier).encode()
    token_marker = ('token-npmrc-' + identifier).encode()
    markers = (context_marker, secret_marker, token_marker)
    owned_tags = []
    report = {'status': 'failed', 'image': args.image, 'platform': args.platform,
              'variants': [], 'cleanup': False}
    cleanup_errors = []
    environment = dict(os.environ, DOCKER_BUILDKIT='1')
    try:
        run(['docker', 'image', 'tag', image['Id'], base])
        owned_tags.append(base)
        with tempfile.TemporaryDirectory(prefix='stf-npmrc-smoke-') as directory:
            temporary = Path(directory)
            secret = temporary / 'secret.npmrc'
            secret.write_text('registry=https://' + secret_marker.decode() + '.invalid/\n'
                              + '//example.invalid/:_authToken=' + token_marker.decode() + '\n')
            for uid in (998, 999):
                for with_secret in (False, True):
                    variant = str(uid) + ('-secret' if with_secret else '-default')
                    print('Checking npmrc: UID ' + str(uid) + ', '
                          + ('secret supplied' if with_secret else 'npm defaults'), flush=True)
                    checks = {'uid': uid, 'secret': with_secret, 'phases': [], 'layers': 'pending'}
                    report['variants'].append(checks)
                    context = temporary / variant
                    context.mkdir()
                    shutil.copyfile(ignore, context / '.dockerignore')
                    (context / '.npmrc').write_text(
                        'registry=https://' + context_marker.decode() + '.invalid/\n')
                    (context / 'package.json').write_text(
                        json.dumps({'name': 'npmrc-smoke', 'version': '0.0.0', 'private': True}))
                    probe = context / '.npmrc-smoke'
                    probe.mkdir()
                    (probe / 'probe.cjs').write_text(PROBE)
                    (probe / 'expected.json').write_text(json.dumps({'uid': uid, 'secret': with_secret,
                                                                           'operation': uuid.uuid4().hex}))
                    dockerfile = temporary / (variant + '.Dockerfile')
                    dockerfile.write_text(fixture_dockerfile(source, base, uid))
                    tags = []
                    for stage in ('dependencies', 'production-dependencies', 'build'):
                        tag = prefix + ':' + variant + '-' + stage
                        command = ['docker', 'build', '--platform', args.platform, '--network=none',
                                   '--pull=false', '--target', stage, '--tag', tag,
                                   '--file', str(dockerfile)]
                        if with_secret:
                            command += ['--secret', 'id=npmrc,src=' + str(secret)]
                        command.append(str(context))
                        run(command, markers, env=environment)
                        owned_tags.append(tag)
                        tags.append(tag)
                        checks['phases'].append({'stage': stage, 'status': 'passed'})
                    scan_saved_layers(tags, markers)
                    checks['layers'] = 'no synthetic npmrc retained'
        report['status'] = 'passed'
    finally:
        # No builder, container, user image or shared cache is pruned by this test.
        for tag in reversed(owned_tags):
            completed = subprocess.run(['docker', 'image', 'rm', '--no-prune', tag],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if completed.returncode:
                cleanup_errors.append(tag)
        report['cleanup'] = not cleanup_errors
        if cleanup_errors:
            report['status'] = 'failed'
            print('Could not remove owned fixture image tags: ' + ', '.join(cleanup_errors), file=sys.stderr)
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2) + '\n')
    if cleanup_errors:
        raise RuntimeError('Fixture image cleanup failed')
    print('npmrc smoke passed: install, prune and pack; UIDs 998/999; secret/default; no leaked layers')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
