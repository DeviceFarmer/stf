"""Bounded USB work; installation and post-launch profile cleanup are separate."""

import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import stat
import subprocess
import uuid
import zipfile

WORK = Path('/work')
APP = 'WebDriverAgentRunner-Runner.app'


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def command(arguments, timeout=30):
    # The image's default /home/node is read-only in the isolated helper pod.
    home = WORK / 'home'
    directories = [home, home / '.local', home / '.local/share', home / '.local/state',
                   home / '.cache', home / '.config']
    for directory in directories:
        require(not directory.is_symlink(), 'unsafe_tool_home')
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
    environment = {**os.environ, 'HOME': str(home), 'XDG_DATA_HOME': str(home / '.local/share'),
                   'XDG_STATE_HOME': str(home / '.local/state'),
                   'XDG_CACHE_HOME': str(home / '.cache'), 'XDG_CONFIG_HOME': str(home / '.config')}
    result = subprocess.run(arguments, capture_output=True, timeout=timeout, env=environment)
    with (WORK / 'installer.log').open('ab') as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(result.stdout + result.stderr)
    require(result.returncode == 0, 'installer_command_failed')
    return result.stdout


def timestamp(value):
    if isinstance(value, dt.datetime):
        return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value.astimezone(dt.timezone.utc)
    require(isinstance(value, str), 'invalid_timestamp')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    # pymobiledevice3 serializes plist UTC datetimes without a suffix.
    return parsed.replace(tzinfo=dt.timezone.utc) if parsed.tzinfo is None else parsed.astimezone(dt.timezone.utc)


def valid_uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value)).lower() == value.lower()
    except (ValueError, TypeError, AttributeError):
        return False


def matching_profiles(profiles, bundle_id, serial):
    require(isinstance(profiles, list), 'invalid_profile_list')
    matches = [p for p in profiles if isinstance(p, dict) and
               isinstance(p.get('Entitlements'), dict) and
               isinstance(p['Entitlements'].get('application-identifier'), str) and
               p['Entitlements']['application-identifier'].partition('.')[2] == bundle_id and
               serial in p.get('ProvisionedDevices', [])]
    require(all(valid_uuid(p.get('UUID')) for p in matches) and
            len({p['UUID'].lower() for p in matches}) == len(matches), 'invalid_profile_ids')
    return matches


def archive_entries(source):
    entries = source.infolist()
    require(0 < len(entries) <= 4096, 'archive_entry_limit')
    seen, total = set(), 0
    for entry in entries:
        name, mode = entry.filename, entry.external_attr >> 16
        parts = PurePosixPath(name).parts
        kind = stat.S_IFMT(mode)
        require(name and not name.startswith('/') and '\\' not in name and
                '\x00' not in name and parts and '..' not in parts and
                name.rstrip('/') == '/'.join(parts) and parts[0] == APP and
                kind in (0, stat.S_IFREG, stat.S_IFDIR) and
                not (entry.flag_bits & 1), 'unsafe_archive')
        canonical = '/'.join(parts)
        require(canonical not in seen and (len(parts) > 1 or entry.is_dir()), 'unsafe_archive')
        require(kind != stat.S_IFDIR or entry.is_dir(), 'unsafe_archive')
        seen.add(canonical)
        total += entry.file_size
        require(total <= 256 * 1024 * 1024, 'archive_size_limit')
    required = {APP + '/Info.plist', APP + '/embedded.mobileprovision',
                APP + '/_CodeSignature/CodeResources',
                APP + '/PlugIns/WebDriverAgentRunner.xctest/Info.plist'}
    require(required.issubset(seen), 'archive_required_files')
    return entries


def validate_archive(archive):
    try:
        with zipfile.ZipFile(archive) as source:
            archive_entries(source)
            require(source.testzip() is None, 'archive_crc_mismatch')
    except (zipfile.BadZipFile, OSError, ValueError):
        raise RuntimeError('invalid_archive') from None


def extract(archive, destination):
    destination.mkdir(mode=0o700)
    with zipfile.ZipFile(archive) as source:
        for entry in archive_entries(source):
            output = destination.joinpath(*PurePosixPath(entry.filename).parts)
            if entry.is_dir():
                output.mkdir(parents=True, exist_ok=True, mode=0o700)
                continue
            output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with source.open(entry) as incoming, output.open('xb') as target:
                copied = 0
                while chunk := incoming.read(1024 * 1024):
                    copied += len(chunk)
                    require(copied <= entry.file_size, 'archive_entry_size')
                    target.write(chunk)
            require(copied == entry.file_size, 'archive_entry_size')
            os.chmod(output, 0o700 if entry.external_attr >> 16 & 0o111 else 0o600)
    return destination / APP


def profile_list(request):
    return matching_profiles(json.loads(command(['pymobiledevice3', 'provision', 'list',
        '--udid=' + request['serial']])), request['bundleId'], request['serial'])


def profile_team(profile):
    team = profile.get('TeamIdentifier')
    require(isinstance(team, list) and len(team) == 1 and
            isinstance(team[0], str) and bool(team[0]), 'profile_team_missing')
    return team


def new_profile(profiles, request):
    found = [p for p in profiles if p['UUID'] == request['profileUUID']]
    require(len(found) == 1 and timestamp(found[0]['ExpirationDate']) ==
            timestamp(request['expiresAt']) and
            profile_team(found[0]) == request['expectedTeamIdentifier'], 'new_profile_not_installed')
    return found[0]


def install(request):
    serial, bundle_id = request['serial'], request['bundleId']
    archive = WORK / 'runner.zip'
    require(hashlib.sha256(archive.read_bytes()).hexdigest() == request['archiveSha256'],
            'archive_hash_mismatch')
    app = extract(archive, WORK / ('unpacked-' + str(uuid.uuid4())))
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    executable = info.get('CFBundleExecutable')
    require(info.get('CFBundleIdentifier') == bundle_id and isinstance(executable, str) and
            executable and Path(executable).name == executable and
            (app / executable).is_file(), 'bundle_mismatch')
    profile = plistlib.loads(command(['openssl', 'cms', '-verify', '-noverify',
        '-inform', 'DER', '-in', str(app / 'embedded.mobileprovision')]))
    require(profile.get('UUID') == request['profileUUID'] and
            profile.get('LocalProvision') is True and
            profile.get('Entitlements', {}).get('application-identifier', '').partition('.')[2] == bundle_id
            and serial in profile.get('ProvisionedDevices', []), 'profile_mismatch')
    expiry = timestamp(profile['ExpirationDate'])
    require(expiry == timestamp(request['expiresAt']), 'profile_expiry_mismatch')
    require(expiry > dt.datetime.now(dt.timezone.utc) +
            dt.timedelta(hours=request['minValidityHours']), 'profile_too_short')
    previous = profile_list(request)
    team = profile_team(profile)
    require(previous and all(profile_team(p) == team for p in previous), 'signing_team_mismatch')
    require(expiry > timestamp(request['previousExpiresAt']) + dt.timedelta(hours=24),
            'profile_not_renewed')
    require(all(timestamp(p['ExpirationDate']) <= expiry for p in previous), 'profile_would_downgrade')
    command(['ios', '--udid=' + serial, 'install', '--path=' + str(app)], 180)
    apps = json.loads(command(['pymobiledevice3', 'apps', 'query', '--udid=' + serial, bundle_id]))
    require(isinstance(apps, dict) and isinstance(apps.get(bundle_id), dict) and
            apps[bundle_id].get('CFBundleIdentifier') == bundle_id and
            apps[bundle_id].get('CFBundleVersion') == info.get('CFBundleVersion') and
            apps[bundle_id].get('ProfileValidated') is True, 'installed_app_missing')
    installed = profile_list(request)
    checked = {**request, 'expectedTeamIdentifier': team}
    new_profile(installed, checked)
    previous_ids = {p['UUID'] for p in previous}
    obsolete = []
    for p in installed:
        if p['UUID'] != profile['UUID']:
            require(p['UUID'] in previous_ids and profile_team(p) == team and
                    timestamp(p['ExpirationDate']) < expiry, 'unexpected_obsolete_profile')
            obsolete.append({'UUID': p['UUID'], 'TeamIdentifier': team,
                             'ExpirationDate': timestamp(p['ExpirationDate']).isoformat()})
    # No profile is removed until the restored runtime proves WDA launch + PNG.
    return {'ok': True, 'mode': 'install', 'obsoleteProfiles': obsolete,
            'expectedTeamIdentifier': team, 'expiresAt': request['expiresAt'],
            'profileUUID': profile['UUID']}


def cleanup(request):
    require(request.get('launchVerified') is True, 'wda_launch_not_verified')
    allowed = request.get('obsoleteProfiles')
    require(isinstance(allowed, list) and all(isinstance(p, dict) and valid_uuid(p.get('UUID'))
            and p['UUID'] != request['profileUUID'] and
            p.get('TeamIdentifier') == request.get('expectedTeamIdentifier') and
            timestamp(p['ExpirationDate']) < timestamp(request['expiresAt']) for p in allowed),
            'invalid_cleanup_allowlist')
    require(len({p['UUID'] for p in allowed}) == len(allowed), 'invalid_cleanup_allowlist')
    allow_by_id = {p['UUID']: p for p in allowed}
    removed = 0
    while True:
        fresh = profile_list(request)
        new_profile(fresh, request)
        old = [p for p in fresh if p['UUID'] != request['profileUUID']]
        for p in old:
            prior = allow_by_id.get(p['UUID'])
            require(prior is not None and profile_team(p) == request['expectedTeamIdentifier'] and
                    timestamp(p['ExpirationDate']) == timestamp(prior['ExpirationDate']),
                    'unexpected_obsolete_profile')
        if not old:
            break
        require(removed < len(allowed), 'profile_cleanup_incomplete')
        p = old[0]
        command(['pymobiledevice3', 'provision', 'remove', '--udid=' + request['serial'], p['UUID']])
        removed += 1
        require(removed <= len(allowed), 'profile_cleanup_incomplete')
    return {'ok': True, 'mode': 'cleanup', 'obsoleteWdaProfilesRemoved': removed,
            'expiresAt': request['expiresAt'], 'profileUUID': request['profileUUID']}


def main():
    os.umask(0o077)
    # A retried kubectl exec cannot start a second installer in this same pod.
    with (WORK / 'helper.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if (WORK / 'result.json').exists():
            return
        try:
            request = json.loads((WORK / 'request.json').read_text())
            require(re.fullmatch(r'[A-Za-z0-9-]{8,80}', request.get('serial', '')) and
                    re.fullmatch(r'[A-Za-z0-9_.-]{3,255}', request.get('bundleId', '')) and
                    valid_uuid(request.get('profileUUID')), 'invalid_request')
            mode = request.get('mode')
            require(mode in ('install', 'cleanup'), 'invalid_mode')
            result = install(request) if mode == 'install' else cleanup(request)
        except Exception as error:
            code = str(error)
            result = {'ok': False, 'error': code if re.fullmatch(r'[a-z_]{1,80}', code)
                      else type(error).__name__}
        temporary = WORK / 'result.tmp'
        with temporary.open('w') as output:
            json.dump(result, output)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(WORK / 'result.json')


if __name__ == '__main__':
    main()
