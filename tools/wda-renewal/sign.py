#!/usr/bin/env python3
"""Build a pinned WDA source with the existing Xcode account and private Keychain."""
import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import stat
import struct
import subprocess
import sys
import traceback
import uuid
import zipfile
from dataclasses import dataclass

SOURCE_SHA = "e7e2665a00633dc174d7fc579f7e606bc9ba782a"
APP_NAME = "WebDriverAgentRunner-Runner.app"
UTC = dt.timezone.utc
HOST_BUILD_ENVIRONMENT = ("CPATH", "C_INCLUDE_PATH", "CPLUS_INCLUDE_PATH", "OBJC_INCLUDE_PATH",
                          "LIBRARY_PATH", "DYLD_LIBRARY_PATH", "SDKROOT", "MACOSX_DEPLOYMENT_TARGET")


class SignError(Exception):
    """Only a fixed reason code is safe for stdout; full command output stays private."""
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def timestamp(value):
    if isinstance(value, dt.datetime):
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    if not isinstance(value, str):
        raise SignError("invalid_timestamp")
    try:
        result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError()
        return result.astimezone(UTC)
    except ValueError:
        raise SignError("invalid_timestamp") from None


def iso(value):
    return timestamp(value).isoformat(timespec="seconds").replace("+00:00", "Z")


def absolute_path(value):
    if not isinstance(value, str) or not value or not Path(value).is_absolute() or ".." in Path(value).parts:
        raise SignError("unsafe_path")
    path = Path(value)
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise SignError("symlink_path")
    return path


def private_bytes(path, limit=1024 * 1024):
    path = absolute_path(str(path))
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        with os.fdopen(descriptor, "rb") as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.getuid():
                raise SignError("private_file_required")
            content = stream.read(limit + 1)
            if len(content) > limit:
                raise SignError("private_file_too_large")
            return content
    except OSError:
        raise SignError("private_file_unavailable") from None


@dataclass(frozen=True)
class Config:
    project_path: Path
    team_id: str
    bundle_id: str
    device_udids: tuple
    state_directory: Path
    artifact_directory: Path
    previous_profile_path: Path
    previous_expires_at: dt.datetime
    min_validity_hours: int = 48
    build_timeout_seconds: int = 900


def load_config(path):
    try:
        value = json.loads(private_bytes(path))
    except (ValueError, TypeError):
        raise SignError("invalid_config_json") from None
    required = {"projectPath", "teamId", "bundleId", "deviceUDIDs", "stateDirectory", "artifactDirectory",
                "previousProfilePath", "previousExpiresAt"}
    optional = {"minValidityHours", "buildTimeoutSeconds"}
    if not isinstance(value, dict) or set(value) - required - optional or not required <= set(value):
        raise SignError("invalid_config_fields")
    team = value["teamId"]
    bundle = value["bundleId"]
    devices = value["deviceUDIDs"]
    if not isinstance(team, str) or not re.fullmatch(r"[A-Z0-9]{10}", team):
        raise SignError("invalid_team")
    if not isinstance(bundle, str) or not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\.xctrunner", bundle):
        raise SignError("invalid_runner_bundle")
    if not isinstance(devices, list) or not 1 <= len(devices) <= 100 or any(
            not isinstance(device, str) or not re.fullmatch(r"[A-Fa-f0-9-]{8,64}", device) for device in devices):
        raise SignError("invalid_devices")
    if len(set(devices)) != len(devices):
        raise SignError("duplicate_devices")
    minimum = value.get("minValidityHours", 48)
    timeout = value.get("buildTimeoutSeconds", 900)
    if type(minimum) is not int or not 48 <= minimum <= 168 or type(timeout) is not int or not 60 <= timeout <= 3600:
        raise SignError("invalid_limits")
    project = absolute_path(value["projectPath"])
    if project.name != "WebDriverAgent.xcodeproj" or not project.is_dir():
        raise SignError("invalid_project")
    return Config(project, team, bundle, tuple(sorted(devices)), absolute_path(value["stateDirectory"]),
                  absolute_path(value["artifactDirectory"]), absolute_path(value["previousProfilePath"]),
                  timestamp(value["previousExpiresAt"]), minimum, timeout)


def private_directory(path):
    path = absolute_path(str(path))
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid():
        raise SignError("private_directory_required")
    return path


def private_write(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())


def stop_process_group(process):
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        process.communicate(timeout=10)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()


def command(args, log, code, timeout=120, capture=False, cwd=None):
    # Xcode must not inherit host include/library paths into the iPhoneOS compiler.
    environment = dict(os.environ)
    for name in HOST_BUILD_ENVIRONMENT:
        environment.pop(name, None)
    environment["LC_ALL"] = "C"
    process = subprocess.Popen(args, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE if capture else log, stderr=log, start_new_session=True)
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        stop_process_group(process)
        raise SignError(code + "_timeout") from None
    except BaseException:
        stop_process_group(process)
        raise
    if process.returncode:
        raise SignError(code)
    if capture and len(output) > 16 * 1024 * 1024:
        raise SignError("command_output_too_large")
    return output or b""


def profile_from_cms(path, log):
    try:
        return plistlib.loads(command(["/usr/bin/security", "cms", "-D", "-i", str(path)], log,
                                      "profile_decode_failed", capture=True))
    except (plistlib.InvalidFileException, ValueError, TypeError):
        raise SignError("invalid_profile_plist") from None


def validate_profile(profile, config, now, previous_expiry, renewal=True):
    if not isinstance(profile, dict):
        raise SignError("invalid_profile")
    entitlements = profile.get("Entitlements", {})
    if profile.get("LocalProvision") is not True or profile.get("ProvisionsAllDevices") is True:
        raise SignError("personal_team_profile_required")
    if profile.get("TeamIdentifier") != [config.team_id] or not isinstance(entitlements, dict):
        raise SignError("profile_team_mismatch")
    if entitlements.get("application-identifier") != config.team_id + "." + config.bundle_id or \
            entitlements.get("com.apple.developer.team-identifier") != config.team_id:
        raise SignError("profile_bundle_mismatch")
    if entitlements.get("get-task-allow") is not True:
        raise SignError("development_profile_required")
    devices = profile.get("ProvisionedDevices")
    if not isinstance(devices, list) or not all(isinstance(device, str) for device in devices) or \
            not set(config.device_udids) <= set(devices):
        raise SignError("profile_devices_missing")
    created = timestamp(profile.get("CreationDate"))
    expires = timestamp(profile.get("ExpirationDate"))
    if created > now + dt.timedelta(minutes=5) or expires <= created:
        raise SignError("invalid_profile_dates")
    if renewal and (expires < now + dt.timedelta(hours=config.min_validity_hours) or
                    expires < previous_expiry + dt.timedelta(days=1)):
        raise SignError("profile_not_renewed")
    profile_uuid = profile.get("UUID")
    if not isinstance(profile_uuid, str) or not re.fullmatch(r"[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}", profile_uuid):
        raise SignError("invalid_profile_uuid")
    return {"profileUUID": profile_uuid, "createdAt": iso(created), "expiresAt": iso(expires),
            "deviceUDIDs": list(config.device_udids)}


def existing_identity(profile, log):
    output = command(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"], log,
                     "identity_inventory_failed", capture=True).decode("utf-8", "replace")
    hashes = set(re.findall(r"^\s*\d+\)\s+([A-F0-9]{40})\s", output, re.M))
    certificates = profile.get("DeveloperCertificates")
    if not isinstance(certificates, list) or not all(isinstance(cert, bytes) for cert in certificates):
        raise SignError("invalid_profile_certificates")
    matching = {hashlib.sha1(cert).hexdigest().upper() for cert in certificates} & hashes
    if len(matching) != 1:
        raise SignError("existing_profile_identity_required")
    return matching.pop()


def verify_source(project, log):
    source = project.parent
    actual = command(["git", "-C", str(source), "rev-parse", "HEAD"], log,
                     "source_revision_failed", capture=True).decode().strip()
    tracked = command(["git", "-C", str(source), "status", "--porcelain", "--untracked-files=all"], log,
                      "source_status_failed", capture=True)
    if actual != SOURCE_SHA or tracked.strip():
        raise SignError("pinned_clean_source_required")
    return source


def ensure_outside_git(path, log):
    result = subprocess.run(["git", "-C", str(path), "rev-parse", "--is-inside-work-tree"],
                            stdout=subprocess.PIPE, stderr=log)
    if result.returncode == 0:
        raise SignError("private_state_must_be_outside_git")


def bundle_files(app):
    app = absolute_path(str(app))
    if app.name != APP_NAME or not app.is_dir():
        raise SignError("invalid_app_root")
    result = []
    for directory, names, files in os.walk(app, followlinks=False):
        for name in sorted(names + files):
            path = Path(directory) / name
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise SignError("unsafe_bundle_entry")
            result.append((path, info))
    return sorted(result, key=lambda item: item[0].relative_to(app).as_posix())


def deterministic_archive(app, archive):
    app = absolute_path(str(app))
    archive = absolute_path(str(archive))
    entries = bundle_files(app)
    descriptor = os.open(archive, os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(descriptor, "w+b") as output:
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
            root = zipfile.ZipInfo(APP_NAME + "/", date_time=(1980, 1, 1, 0, 0, 0))
            root.create_system = 3
            root.external_attr = (stat.S_IFDIR | stat.S_IMODE(app.stat().st_mode)) << 16 | 0x10
            zipped.writestr(root, b"")
            for path, info in entries:
                directory = stat.S_ISDIR(info.st_mode)
                name = APP_NAME + "/" + path.relative_to(app).as_posix() + ("/" if directory else "")
                member = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                member.create_system = 3
                member.external_attr = (stat.S_IFDIR if directory else stat.S_IFREG) << 16
                member.external_attr |= stat.S_IMODE(info.st_mode) << 16
                if directory:
                    member.external_attr |= 0x10
                member.compress_type = zipfile.ZIP_DEFLATED
                with path.open("rb") if not directory else contextlib.nullcontext(None) as stream:
                    zipped.writestr(member, stream.read() if stream else b"")
        output.flush()
        os.fsync(output.fileno())
    return hashlib.sha256(archive.read_bytes()).hexdigest()


def runtime_macho(path):
    """dSYM companions are Mach-O too, but contain debug data rather than loadable code."""
    thin = {b"\xfe\xed\xfa\xce": ">", b"\xce\xfa\xed\xfe": "<",
            b"\xfe\xed\xfa\xcf": ">", b"\xcf\xfa\xed\xfe": "<"}
    fat = {b"\xca\xfe\xba\xbe": (">", False), b"\xbe\xba\xfe\xca": ("<", False),
           b"\xca\xfe\xba\xbf": (">", True), b"\xbf\xba\xfe\xca": ("<", True)}
    with path.open("rb") as stream:
        header = stream.read(16)
        if header[:4] in thin:
            if len(header) < 16:
                raise SignError("invalid_macho_header")
            return struct.unpack(thin[header[:4]] + "I", header[12:16])[0] in (2, 6, 7, 8)
        if header[:4] not in fat:
            return False
        endian, wide = fat[header[:4]]
        if len(header) < 8:
            raise SignError("invalid_macho_header")
        count = struct.unpack(endian + "I", header[4:8])[0]
        if not 1 <= count <= 64:
            raise SignError("invalid_macho_architectures")
        size = 32 if wide else 20
        stream.seek(8)
        records = stream.read(count * size)
        if len(records) != count * size:
            raise SignError("invalid_macho_architectures")
        runtime = False
        for number in range(count):
            record = records[number * size:(number + 1) * size]
            offset = struct.unpack(endian + ("Q" if wide else "I"), record[8:16 if wide else 12])[0]
            if offset < 8 + count * size:
                raise SignError("invalid_macho_architecture_offset")
            stream.seek(offset)
            architecture = stream.read(16)
            if len(architecture) < 16 or architecture[:4] not in thin:
                raise SignError("invalid_macho_architecture")
            runtime |= struct.unpack(thin[architecture[:4]] + "I", architecture[12:16])[0] in (2, 6, 7, 8)
        return runtime


def verify_app(app, config, now, previous_expiry, identity, attempt, log):
    entries = bundle_files(app)
    command(["/usr/bin/codesign", "--verify", "--deep", "--strict", "--all-architectures", str(app)],
            log, "app_signature_invalid")
    # Verify every nested executable, including dylibs outside framework bundles.
    count = 0
    for path, info in entries:
        if stat.S_ISREG(info.st_mode) and runtime_macho(path):
            command(["/usr/bin/codesign", "--verify", "--strict", "--all-architectures", str(path)],
                    log, "nested_signature_invalid")
            count += 1
    if not count:
        raise SignError("signed_executable_missing")
    try:
        info = plistlib.loads((app / "Info.plist").read_bytes())
    except (ValueError, plistlib.InvalidFileException):
        raise SignError("invalid_app_info") from None
    if info.get("CFBundleIdentifier") != config.bundle_id:
        raise SignError("app_bundle_mismatch")
    executable = info.get("CFBundleExecutable")
    if not isinstance(executable, str) or not re.fullmatch(r"[A-Za-z0-9_.-]+", executable) or \
            not (app / executable).is_file() or not ((app / executable).stat().st_mode & 0o111):
        raise SignError("app_executable_invalid")
    profile = profile_from_cms(app / "embedded.mobileprovision", log)
    result = validate_profile(profile, config, now, previous_expiry)
    signed_entitlements = command(["/usr/bin/codesign", "-d", "--entitlements", ":-", str(app)],
                                  log, "app_entitlements_failed", capture=True)
    try:
        entitlements = plistlib.loads(signed_entitlements)
    except (ValueError, plistlib.InvalidFileException):
        raise SignError("invalid_app_entitlements") from None
    if entitlements.get("application-identifier") != config.team_id + "." + config.bundle_id or \
            entitlements.get("com.apple.developer.team-identifier") != config.team_id:
        raise SignError("signed_entitlements_mismatch")
    certificate_prefix = attempt / "signing-certificate-"
    command(["/usr/bin/codesign", "-d", "--extract-certificates=" + str(certificate_prefix), str(app)],
            log, "signing_certificate_extract_failed")
    certificate = Path(str(certificate_prefix) + "0")
    certificate.chmod(0o600)
    leaf = certificate.read_bytes()
    if hashlib.sha1(leaf).hexdigest().upper() != identity or leaf not in profile.get("DeveloperCertificates", []):
        raise SignError("signing_identity_changed")
    # The signing certificate must remain valid for the complete renewed profile lifetime.
    seconds = max(1, math.ceil((timestamp(result["expiresAt"]) - now).total_seconds()))
    command(["/usr/bin/openssl", "x509", "-inform", "DER", "-in", str(certificate), "-noout", "-checkend", str(seconds)],
            log, "signing_certificate_expires_too_soon")
    for path in attempt.glob("signing-certificate-*"):
        path.chmod(0o600)
    return result


class ProfileCacheRefresh:
    """Temporarily remove only the exact stale Personal Team profile, with verified rollback."""
    def __init__(self, config, profile, attempt, log, roots=None):
        self.config = config
        self.profile = profile
        self.attempt = attempt
        self.log = log
        self.roots = roots if roots is not None else (
            Path.home() / "Library/Developer/Xcode/UserData/Provisioning Profiles",
            Path.home() / "Library/MobileDevice/Provisioning Profiles")
        self.records = []
        self.removed = set()
        self.committed = False

    def __enter__(self):
        other = subprocess.run(["/usr/bin/pgrep", "-x", "xcodebuild"], stdout=subprocess.PIPE, stderr=self.log)
        if other.returncode != 1:
            raise SignError("other_xcodebuild_active")
        validate_profile(self.profile, self.config, dt.datetime.now(UTC), self.config.previous_expires_at, renewal=False)
        backup = private_directory(self.attempt / "profile-cache-backup")
        try:
            for root in self.roots:
                if not root.is_dir() or root.is_symlink():
                    continue
                for path in sorted(root.glob("*.mobileprovision")):
                    if path.is_symlink() or not path.is_file() or path.resolve() == self.config.previous_profile_path.resolve():
                        continue
                    info = path.stat()
                    if info.st_uid != os.getuid() or info.st_size > 1024 * 1024:
                        continue
                    try:
                        candidate = profile_from_cms(path, self.log)
                    except SignError:
                        continue
                    if candidate.get("UUID") != self.profile["UUID"] or candidate.get("TeamIdentifier") != [self.config.team_id] or \
                            candidate.get("Entitlements", {}).get("application-identifier") != self.config.team_id + "." + self.config.bundle_id:
                        continue
                    content = path.read_bytes()
                    saved = backup / ("profile-" + str(len(self.records)) + ".mobileprovision")
                    private_write(saved, content)
                    self.records.append({"originalPath": str(path), "backupPath": str(saved),
                                         "sha256": hashlib.sha256(content).hexdigest(), "mode": stat.S_IMODE(info.st_mode)})
            if not self.records:
                raise SignError("exact_cached_profile_not_found")
            private_write(backup / "cache-moves.json", (json.dumps(self.records, sort_keys=True, indent=2) + "\n").encode())
            for record in self.records:
                path = Path(record["originalPath"])
                if hashlib.sha256(path.read_bytes()).hexdigest() != record["sha256"]:
                    raise SignError("cached_profile_changed")
                path.unlink()
                self.removed.add(record["originalPath"])
        except Exception:
            self.restore()
            raise
        return self

    def commit(self):
        self.committed = True

    def restore(self):
        failures = []
        for record in self.records:
            if record["originalPath"] not in self.removed:
                continue
            path = Path(record["originalPath"])
            staging = path.parent / (".wda-profile-restore-" + uuid.uuid4().hex)
            try:
                content = Path(record["backupPath"]).read_bytes()
                if hashlib.sha256(content).hexdigest() != record["sha256"]:
                    raise SignError("profile_cache_restore_failed")
                private_write(staging, content)
                try:
                    staging.chmod(record["mode"])
                    # Xcode may recreate the cache entry while the signer runs.
                    try:
                        os.link(staging, path)
                    except FileExistsError:
                        flags = os.O_RDONLY | os.O_NONBLOCK | getattr(os, "O_NOFOLLOW", 0)
                        with os.fdopen(os.open(path, flags), "rb") as existing:
                            info = os.fstat(existing.fileno())
                            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or \
                                    stat.S_IMODE(info.st_mode) != record["mode"] or \
                                    info.st_size != len(content) or existing.read(len(content) + 1) != content:
                                raise SignError("profile_cache_restore_failed")
                finally:
                    staging.unlink(missing_ok=True)
            except (OSError, SignError) as error:
                failures.append(error)
        if failures:
            raise SignError("profile_cache_restore_failed") from failures[0]

    def __exit__(self, error_type, error, tb):
        if not self.committed:
            self.restore()


def prune_attempts(state, active_attempt, artifacts, limit=20):
    candidates = []
    for path in state.iterdir():
        if path == active_attempt or path == artifacts or path.is_symlink() or not path.is_dir():
            continue
        if re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}", path.name):
            candidates.append(path)
    for path in sorted(candidates, key=lambda entry: entry.name, reverse=True)[limit - 1:]:
        shutil.rmtree(path)


def build_app(config, source, derived, log):
    command(["/usr/bin/xcodebuild", "build-for-testing", "-project", str(config.project_path),
             "-scheme", "WebDriverAgentRunner", "-configuration", "Debug", "-destination", "generic/platform=iOS",
             "-derivedDataPath", str(derived), "-allowProvisioningUpdates", "CODE_SIGN_STYLE=Automatic",
             "CODE_SIGN_IDENTITY=Apple Development", "DEVELOPMENT_TEAM=" + config.team_id,
             "PRODUCT_BUNDLE_IDENTIFIER=" + config.bundle_id[:-len(".xctrunner")]],
            log, "xcodebuild_failed", timeout=config.build_timeout_seconds, cwd=source)
    return derived / "Build/Products/Debug-iphoneos" / APP_NAME


def sign(config):
    state = private_directory(config.state_directory)
    artifacts = private_directory(config.artifact_directory)
    if state == artifacts:
        raise SignError("separate_artifact_directory_required")
    with open(os.devnull, "wb") as discard:
        ensure_outside_git(state, discard)
        ensure_outside_git(artifacts, discard)
    attempt_id = dt.datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    attempt = private_directory(state / attempt_id)
    log_path = attempt / "sign.log"
    descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb", buffering=0) as log:
        try:
            ensure_outside_git(state, log)
            ensure_outside_git(artifacts, log)
            lock_descriptor = os.open(state / "sign.lock", os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
            with os.fdopen(lock_descriptor, "wb") as lock:
                lock_info = os.fstat(lock.fileno())
                if not stat.S_ISREG(lock_info.st_mode) or stat.S_IMODE(lock_info.st_mode) != 0o600 or lock_info.st_uid != os.getuid():
                    raise SignError("private_lock_required")
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise SignError("signer_busy") from None
                derived_directories = []
                try:
                    private_bytes(config.previous_profile_path)
                    source = verify_source(config.project_path, log)
                    old = profile_from_cms(config.previous_profile_path, log)
                    now = dt.datetime.now(UTC)
                    validate_profile(old, config, now, config.previous_expires_at, renewal=False)
                    if timestamp(old["ExpirationDate"]) != config.previous_expires_at:
                        raise SignError("previous_profile_expiry_mismatch")
                    identity = existing_identity(old, log)
                    derived = attempt / "derived-data"
                    derived_directories.append(derived)
                    built_app = build_app(config, source, derived, log)
                    try:
                        result = verify_app(built_app, config, dt.datetime.now(UTC), config.previous_expires_at, identity, attempt, log)
                    except SignError as error:
                        if error.code != "profile_not_renewed":
                            raise
                        stale = profile_from_cms(built_app / "embedded.mobileprovision", log)
                        with ProfileCacheRefresh(config, stale, attempt, log) as refresh:
                            derived = attempt / "derived-data-refresh"
                            derived_directories.append(derived)
                            built_app = build_app(config, source, derived, log)
                            result = verify_app(built_app, config, dt.datetime.now(UTC), config.previous_expires_at, identity, attempt, log)
                            refresh.commit()
                    artifact = private_directory(artifacts / attempt_id)
                    app = artifact / APP_NAME
                    shutil.copytree(built_app, app, symlinks=False)
                    command(["/usr/bin/codesign", "--verify", "--deep", "--strict", "--all-architectures", str(app)],
                            log, "copied_signature_invalid")
                    archive = artifact / (APP_NAME + ".zip")
                    archive_hash = deterministic_archive(app, archive)
                    manifest = {"version": 1, "bundleId": config.bundle_id, **result, "appPath": str(app),
                                "archivePath": str(archive), "archiveSha256": archive_hash, "sourceSHA": SOURCE_SHA}
                    manifest_path = artifact / "manifest.json"
                    private_write(manifest_path, (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode())
                    outcome = {"status": "signed", "manifestPath": str(manifest_path), "expiresAt": result["expiresAt"]}
                except Exception as error:
                    log.write(traceback.format_exc().encode())
                    outcome = {"status": "blocked", "reason": error.code if isinstance(error, SignError) else "signing_failed", "logPath": str(log_path)}
                finally:
                    try:
                        for derived in derived_directories:
                            if derived.is_symlink():
                                derived.unlink()
                            elif derived.exists():
                                shutil.rmtree(derived)
                        prune_attempts(state, attempt, artifacts)
                    except Exception:
                        log.write(traceback.format_exc().encode())
                        outcome = {"status": "blocked", "reason": "private_build_cleanup_failed", "logPath": str(log_path)}
                return outcome
        except Exception as error:
            log.write(traceback.format_exc().encode())
            return {"status": "blocked", "reason": error.code if isinstance(error, SignError) else "signing_failed", "logPath": str(log_path)}


def cancelled(_number, _frame):
    raise SignError("signer_cancelled")


def main():
    os.umask(0o077)
    signal.signal(signal.SIGTERM, cancelled)
    signal.signal(signal.SIGINT, cancelled)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    try:
        config = load_config(Path(args.config))
        private_bytes(config.previous_profile_path)
        result = sign(config)
    except Exception as error:
        result = {"status": "blocked", "reason": error.code if isinstance(error, SignError) else "configuration_failed"}
    print(json.dumps(result, sort_keys=True))
    return 0 if result["status"] == "signed" else 1


if __name__ == "__main__":
    sys.exit(main())
