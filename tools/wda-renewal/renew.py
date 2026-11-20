#!/usr/bin/env python3
"""Renew due WDA profiles once, then exit; resume an unfinished renewal safely."""

import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import threading
import uuid
import zipfile

from worker import Worker, RenewalError, date, private_json, require, save_json


UTC = dt.timezone.utc


def now():
    return dt.datetime.now(UTC)


def iso(value):
    return value.astimezone(UTC).isoformat(timespec='seconds').replace('+00:00', 'Z')


def absolute_path(value):
    require(isinstance(value, str) and value and '\x00' not in value, 'invalid_private_path')
    path = Path(value)
    require(path.is_absolute() and '..' not in path.parts, 'invalid_private_path')
    require(all(not part.is_symlink() for part in (path, *path.parents)), 'unsafe_private_path')
    return path


def private_file(value, maximum=2 * 1024 * 1024):
    path = absolute_path(str(value))
    require(path.is_file() and stat.S_IMODE(path.stat().st_mode) == 0o600 and
            path.stat().st_uid == os.getuid() and
            (maximum is None or path.stat().st_size < maximum),
            'private_file_required')
    return path


def read_private(value):
    return private_json(private_file(value))


def private_directory(value):
    path = absolute_path(str(value))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(path.is_dir() and stat.S_IMODE(path.stat().st_mode) == 0o700 and
            path.stat().st_uid == os.getuid(), 'private_directory_required')
    return path


def validate_config(config):
    required = {'version', 'stateDirectory', 'signerConfigPath', 'workerConfigPath'}
    optional = {'renewBeforeHours'}
    require(isinstance(config, dict) and required <= config.keys() and
            config.keys() <= required | optional, 'invalid_renewal_config')
    require(type(config['version']) is int and config['version'] == 1, 'config_version')
    threshold = config.get('renewBeforeHours', 48)
    require(type(threshold) is int and 48 <= threshold <= 120, 'invalid_renewal_threshold')
    state = absolute_path(config['stateDirectory'])
    if state.exists():
        require(state.is_dir() and stat.S_IMODE(state.stat().st_mode) == 0o700 and
                state.stat().st_uid == os.getuid(), 'private_directory_required')
    for key in ('signerConfigPath', 'workerConfigPath'):
        require(isinstance(read_private(config[key]), dict), 'invalid_nested_config')
    return dict(config)


def error_code(error):
    # Exceptions from external tools or malformed input must not leak identities.
    if isinstance(error, RenewalError) and re.fullmatch(r'[a-z][a-z0-9_]{0,80}', str(error)):
        return str(error)
    return 'operation_failed'


def manifest_for_target(manifest, target):
    require(isinstance(manifest, dict) and type(manifest.get('version')) is int and
            manifest['version'] == 1 and manifest.get('bundleId') == target['bundleId'] and
            isinstance(manifest.get('deviceUDIDs'), list) and
            target['serial'] in manifest['deviceUDIDs'], 'artifact_manifest_invalid')
    date(manifest.get('expiresAt'))
    return manifest


def current_artifact(state, target, previous_expiry, minimum):
    path = state.get('manifestPath')
    if not path:
        return None
    try:
        manifest = manifest_for_target(read_private(path), target)
        if date(manifest['expiresAt']) <= now() + dt.timedelta(hours=minimum) or \
                date(manifest['expiresAt']) <= date(previous_expiry) + dt.timedelta(hours=24):
            return None
        archive = absolute_path(manifest['archivePath'])
        # A missing/corrupt cache may be replaced; a pending operation may not.
        require(archive.is_file() and not archive.is_symlink() and
                archive.stat().st_mode & 0o077 == 0 and
                0 < archive.stat().st_size < 128 * 1024 * 1024 and
                hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['archiveSha256'],
                'artifact_cache_invalid')
        return manifest
    except (RenewalError, OSError, ValueError, TypeError, KeyError):
        return None


def signing(config, state, state_dir):
    signer = read_private(config['signerConfigPath'])
    if state.get('currentProfilePath'):
        private_file(state['currentProfilePath'])
        signer['previousProfilePath'] = state['currentProfilePath']
        signer['previousExpiresAt'] = state['currentProfileExpiresAt']
    invocation = state_dir / 'signer-invocation.json'
    save_json(invocation, signer)
    try:
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('sign.py')),
            '--config', str(invocation)], capture_output=True, text=True,
            timeout=2 * signer.get('buildTimeoutSeconds', 900) + 600)
    except subprocess.TimeoutExpired:
        raise RenewalError('signer_timeout') from None
    try:
        response = json.loads(result.stdout)
    except (ValueError, TypeError):
        raise RenewalError('signer_response_invalid') from None
    require(isinstance(response, dict), 'signer_response_invalid')
    if result.returncode != 0 or response.get('status') != 'signed':
        reason = response.get('reason', 'failed')
        raise RenewalError('signer_' + reason if isinstance(reason, str) and
                           re.fullmatch(r'[a-z][a-z0-9_]{0,60}', reason) else 'signer_failed')
    manifest = read_private(response.get('manifestPath', ''))
    require(isinstance(manifest, dict), 'signer_response_invalid')
    state['manifestPath'] = response['manifestPath']
    save_json(state_dir / 'service-state.json', state)
    return manifest


def retain_profile(state, manifest, state_dir):
    profile_uuid = manifest.get('profileUUID', '')
    require(isinstance(profile_uuid, str) and re.fullmatch(
        r'[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}', profile_uuid),
        'invalid_profile_uuid')
    if state.get('currentProfileExpiresAt') and date(state['currentProfileExpiresAt']) > date(manifest['expiresAt']):
        private_file(state['currentProfilePath'])
        return
    # Worker installs the verified ZIP, so its embedded profile is authoritative.
    # The adjacent appPath is only a signing output and may have changed since.
    archive = absolute_path(manifest['archivePath'])
    require(archive.is_file() and stat.S_IMODE(archive.stat().st_mode) == 0o600 and
            archive.stat().st_uid == os.getuid() and 0 < archive.stat().st_size < 128 * 1024 * 1024,
            'accepted_archive_invalid')
    require(hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['archiveSha256'],
            'accepted_archive_hash_mismatch')
    with zipfile.ZipFile(archive) as bundle:
        entries = [entry for entry in bundle.infolist() if entry.filename ==
                   'WebDriverAgentRunner-Runner.app/embedded.mobileprovision']
        require(len(entries) == 1 and 0 < entries[0].file_size < 2 * 1024 * 1024 and
                not entries[0].flag_bits & 1 and
                stat.S_IFMT(entries[0].external_attr >> 16) in (0, stat.S_IFREG),
                'accepted_profile_invalid')
        content = bundle.read(entries[0])
    destination = state_dir / ('current-' + profile_uuid + '-' + hashlib.sha256(content).hexdigest()[:16] + '.mobileprovision')
    if destination.exists() or destination.is_symlink():
        require(private_file(destination).read_bytes() == content, 'accepted_profile_conflict')
    else:
        temporary = destination.with_name(destination.name + '.' + uuid.uuid4().hex + '.tmp')
        try:
            with temporary.open('xb') as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(destination)
            descriptor = os.open(state_dir, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            temporary.unlink(missing_ok=True)
    state.update(currentProfilePath=str(destination), currentProfileExpiresAt=manifest['expiresAt'])


def prune_artifacts(config, state, workers):
    """Bound published builds; preserve pending builds and active worker journals."""
    signer = read_private(config['signerConfigPath'])
    if 'artifactDirectory' not in signer:
        return
    root = absolute_path(signer['artifactDirectory'])
    if not root.exists():
        return
    private_directory(root)
    protected_paths = {state.get('manifestPath'), *state.get('pending', {}).values(),
                       *state.get('accepted', {}).values()}
    protected_hashes = set()
    worker_state = absolute_path(workers['stateDirectory'])
    for target in workers['devices']:
        journal = worker_state / (target['serial'] + '.json')
        if journal.exists() or journal.is_symlink():
            record = read_private(journal)
            if not record.get('completed'):
                protected_hashes.add(record.get('archiveSha256'))
    published = []
    for directory in root.iterdir():
        if directory.is_symlink() or not directory.is_dir() or not re.fullmatch(
                r'\d{8}T\d{6}Z-[a-f0-9]{8}', directory.name):
            continue
        path = directory / 'manifest.json'
        if not path.exists():
            continue
        try:
            manifest = read_private(path)
            require(manifest.get('appPath') == str(directory / 'WebDriverAgentRunner-Runner.app') and
                    manifest.get('archivePath') == str(directory / 'WebDriverAgentRunner-Runner.app.zip'),
                    'artifact_layout_invalid')
        except (RenewalError, OSError, ValueError, TypeError):
            continue
        published.append((directory, path, manifest.get('archiveSha256')))
    published.sort(key=lambda item: item[0].name, reverse=True)
    for directory, path, archive_hash in published[3:]:
        if str(path) not in protected_paths and archive_hash not in protected_hashes:
            shutil.rmtree(directory)


def _cycle(config, worker_factory=Worker, signer=signing, stop_event=None):
    config = validate_config(config)
    state_dir = private_directory(config['stateDirectory'])
    # Keep the original filename so pending operations survive the manual-command migration.
    state_file = state_dir / 'service-state.json'
    state = read_private(state_file) if state_file.exists() or state_file.is_symlink() else {'pending': {}}
    require(isinstance(state, dict) and isinstance(state.get('pending'), dict) and
            isinstance(state.get('accepted', {}), dict) and
            all(isinstance(key, str) and isinstance(path, str) and path
                for key, path in state['pending'].items()) and
            all(state['pending'].get(key) == path for key, path in state.get('accepted', {}).items()),
            'renewal_state_invalid')
    workers = read_private(config['workerConfigPath'])
    require(isinstance(workers.get('devices'), list) and workers['devices'], 'invalid_worker_devices')
    minimum = workers.get('minValidityHours', 48)
    require(type(minimum) is int and 48 <= minimum <= 168, 'invalid_minimum_validity')
    status = {'checkedAt': iso(now()), 'renewed': 0, 'notDue': 0, 'offline': 0, 'busy': 0,
              'failed': 0, 'errors': []}
    threshold = config.get('renewBeforeHours', 48)
    for target in workers['devices']:
        if stop_event is not None and stop_event.is_set():
            status['failed'] += 1
            status['errors'].append('renewal_interrupted')
            break
        serial = None
        try:
            require(isinstance(target, dict), 'invalid_target')
            serial = target['serial']
            pending = state['pending'].get(serial)
            worker = None
            if pending:
                manifest = manifest_for_target(read_private(pending), target)
            else:
                worker = worker_factory(workers, target, workers['stateDirectory'])
                device = worker.device()
                profile = device.get('ios', {}).get('wda', {})
                expiry = profile.get('expiresAt')
                expired_recovery = (workers.get('allowExpiredWdaRecovery') is True and
                                    profile.get('profile') == 'expired' and expiry and date(expiry) <= now())
                if device.get('present') is not True or not expiry or \
                        (device.get('ready') is not True and not expired_recovery):
                    status['offline'] += 1
                    continue
                if date(expiry) > now() + dt.timedelta(hours=threshold):
                    status['notDue'] += 1
                    continue
                # Manual owners stay untouched; Worker drains existing automation.
                if (device.get('owner') or device.get('using') or device.get('claimed')) and \
                        device.get('usage') != 'automation':
                    status['busy'] += 1
                    continue
                manifest = current_artifact(state, target, expiry, minimum)
                if manifest is None:
                    manifest = manifest_for_target(signer(config, state, state_dir), target)
                state['pending'][serial] = state['manifestPath']
                save_json(state_file, state)
            if state.get('accepted', {}).get(serial) != pending or not pending:
                worker = worker or worker_factory(workers, target, workers['stateDirectory'])
                result = worker.run(manifest)
                require(isinstance(result, dict) and result.get('status') == 'renewed', 'worker_not_completed')
                require('expiresAt' not in result or date(result['expiresAt']) == date(manifest['expiresAt']),
                        'worker_expiry_mismatch')
                state.setdefault('accepted', {})[serial] = state['pending'][serial]
                save_json(state_file, state)
            retain_profile(state, manifest, state_dir)
            del state['pending'][serial]
            state.get('accepted', {}).pop(serial, None)
            state['lastSuccessAt'] = iso(now())
            save_json(state_file, state)
            status['renewed'] += 1
        except Exception as error:
            if isinstance(error, RenewalError) and str(error) == 'device_missing' and not state['pending'].get(serial):
                status['offline'] += 1
            else:
                status['failed'] += 1
                status['errors'].append(error_code(error))
    try:
        prune_artifacts(config, state, workers)
    except Exception as error:
        status['failed'] += 1
        status['errors'].append('artifact_retention_' + error_code(error))
    status['lastSuccessAt'] = state.get('lastSuccessAt')
    save_json(state_dir / 'status.json', status)
    return status



@contextlib.contextmanager
def operation_lock(state_dir):
    state_dir = private_directory(str(state_dir))
    path = absolute_path(str(state_dir / 'operation.lock'))
    if path.exists():
        private_file(path)
    with path.open('a') as lock:
        os.fchmod(lock.fileno(), 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RenewalError('renewal_active') from None
        yield


def cycle(config, worker_factory=Worker, signer=signing, stop_event=None):
    config = validate_config(config)
    with operation_lock(config['stateDirectory']):
        return _cycle(config, worker_factory, signer, stop_event)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--status', action='store_true', help='show the last completed command result without connecting')
    args = parser.parse_args()
    config = validate_config(read_private(args.config))
    state_dir = private_directory(config['stateDirectory'])
    if args.status:
        print(json.dumps(read_private(state_dir / 'status.json')))
        return 0
    stop = threading.Event()
    # Finish a current device before honoring an interrupt; never start the next one.
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        result = cycle(config, stop_event=stop)
    except Exception as error:
        result = {'checkedAt': iso(now()), 'failed': 1, 'errors': [error_code(error)]}
        # Another invocation owns status.json while its operation lock is held.
        if not (isinstance(error, RenewalError) and str(error) == 'renewal_active'):
            save_json(state_dir / 'status.json', result)
    print(json.dumps(result), flush=True)
    return 1 if any(result.get(key, 0) for key in ('failed', 'offline', 'busy')) else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'status': 'blocked', 'reason': error_code(error)}))
        sys.exit(1)
