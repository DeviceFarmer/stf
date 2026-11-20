"""Offline controls for the signer; fixtures never contain real signing inputs."""

import copy
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import struct
import sys
import tempfile
import unittest
from unittest import mock
import zipfile


SPEC = importlib.util.spec_from_file_location("wda_renewal_sign", Path(__file__).with_name("sign.py"))
sign = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sign
SPEC.loader.exec_module(sign)

NOW = dt.datetime(2030, 1, 1, 12, tzinfo=dt.timezone.utc)
TEAM = "FAKETEAM01"
BUNDLE = "org.example.fixture.WebDriverAgentRunner.xctrunner"
DEVICES = ("0000000000000000000000000000000000000001",
           "0000000000000000000000000000000000000002",
           "0000000000000000000000000000000000000003")
PROFILE_UUID = "00000000-0000-0000-0000-000000000001"
DEFAULT_CONFIG = object()


class SignerCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="wda-signer-test-")
        self.addCleanup(temporary.cleanup)
        # macOS's default temporary path may contain the /var symlink.
        self.root = Path(temporary.name).resolve()
        self.project = self.root / "source" / "WebDriverAgent.xcodeproj"
        self.project.mkdir(parents=True)
        self.config_path = self.root / "config.json"
        self.config_data = {
            "projectPath": str(self.project),
            "teamId": TEAM,
            "bundleId": BUNDLE,
            "deviceUDIDs": list(reversed(DEVICES)),
            "stateDirectory": str(self.root / "state"),
            "artifactDirectory": str(self.root / "artifacts"),
            "previousProfilePath": str(self.root / "old.mobileprovision"),
            "previousExpiresAt": sign.iso(NOW + dt.timedelta(days=2)),
        }

    def write_config(self, data=DEFAULT_CONFIG, mode=0o600):
        if self.config_path.exists():
            self.config_path.chmod(0o600)
        self.config_path.write_text(json.dumps(self.config_data if data is DEFAULT_CONFIG else data))
        self.config_path.chmod(mode)
        return self.config_path

    def config(self):
        return sign.load_config(self.write_config())

    def assert_error(self, code, function, *args, **kwargs):
        with self.assertRaises(sign.SignError) as caught:
            function(*args, **kwargs)
        self.assertEqual(code, caught.exception.code)

    def profile(self):
        return {
            "UUID": PROFILE_UUID,
            "LocalProvision": True,
            "TeamIdentifier": [TEAM],
            "CreationDate": NOW - dt.timedelta(minutes=1),
            "ExpirationDate": NOW + dt.timedelta(days=5),
            "ProvisionedDevices": list(DEVICES),
            "Entitlements": {
                "application-identifier": TEAM + "." + BUNDLE,
                "com.apple.developer.team-identifier": TEAM,
                "get-task-allow": True,
            },
        }

    def validate(self, profile, previous_expiry=None, **kwargs):
        return sign.validate_profile(profile, self.config(), NOW,
                                     previous_expiry or NOW + dt.timedelta(days=2), **kwargs)


class ConfigTests(SignerCase):
    def test_private_config_loads_exact_identifiers_and_defaults(self):
        config = self.config()
        self.assertIsInstance(config, sign.Config)
        self.assertEqual(self.project, config.project_path)
        self.assertEqual(TEAM, config.team_id)
        self.assertEqual(BUNDLE, config.bundle_id)
        self.assertEqual(DEVICES, config.device_udids)
        self.assertEqual(self.root / "state", config.state_directory)
        self.assertEqual(self.root / "artifacts", config.artifact_directory)
        self.assertEqual(self.root / "old.mobileprovision", config.previous_profile_path)
        self.assertEqual(NOW + dt.timedelta(days=2), config.previous_expires_at)
        self.assertEqual(48, config.min_validity_hours)
        self.assertEqual(900, config.build_timeout_seconds)

    def test_config_requires_exactly_0600(self):
        for mode in (0o400, 0o640, 0o644, 0o660, 0o700):
            with self.subTest(mode=oct(mode)):
                self.assert_error("private_file_required", sign.load_config,
                                  self.write_config(mode=mode))

    def test_config_symlink_is_rejected(self):
        target = self.write_config()
        link = self.root / "linked-config.json"
        link.symlink_to(target)
        self.assert_error("symlink_path", sign.load_config, link)

    def test_config_under_symlinked_directory_is_rejected(self):
        self.write_config()
        link = self.root / "linked-directory"
        link.symlink_to(self.root, target_is_directory=True)
        self.assert_error("symlink_path", sign.load_config, link / self.config_path.name)

    def test_config_rejects_unknown_or_missing_fields(self):
        extra = dict(self.config_data, unapprovedSetting=True)
        missing = dict(self.config_data)
        del missing["previousProfilePath"]
        for value in (extra, missing, [], None):
            with self.subTest(value=value):
                self.assert_error("invalid_config_fields", sign.load_config, self.write_config(value))

    def test_config_rejects_relative_and_parent_traversal_paths(self):
        for field in ("projectPath", "stateDirectory", "artifactDirectory", "previousProfilePath"):
            for value in ("relative/path", str(self.root / "child" / ".." / "target")):
                with self.subTest(field=field, value=value):
                    data = dict(self.config_data, **{field: value})
                    self.assert_error("unsafe_path", sign.load_config, self.write_config(data))

    def test_config_rejects_symlinks_in_each_configured_path(self):
        link = self.root / "linked-path"
        link.symlink_to(self.root, target_is_directory=True)
        for field in ("projectPath", "stateDirectory", "artifactDirectory", "previousProfilePath"):
            with self.subTest(field=field):
                data = dict(self.config_data, **{field: str(link / "fixture")})
                self.assert_error("symlink_path", sign.load_config, self.write_config(data))

    def test_config_rejects_duplicate_devices_and_insecure_limits(self):
        cases = [({"deviceUDIDs": [DEVICES[0], DEVICES[0]]}, "duplicate_devices"),
                 ({"minValidityHours": 47}, "invalid_limits"),
                 ({"minValidityHours": True}, "invalid_limits"),
                 ({"buildTimeoutSeconds": 59}, "invalid_limits")]
        for changes, error in cases:
            with self.subTest(changes=changes):
                self.assert_error(error, sign.load_config, self.write_config(dict(self.config_data, **changes)))


class ProfileTests(SignerCase):
    def test_profile_returns_only_expected_metadata_for_all_three_devices(self):
        profile = self.profile()
        original = copy.deepcopy(profile)
        metadata = self.validate(profile)
        self.assertEqual({"profileUUID": PROFILE_UUID,
                          "createdAt": sign.iso(NOW - dt.timedelta(minutes=1)),
                          "expiresAt": sign.iso(NOW + dt.timedelta(days=5)),
                          "deviceUDIDs": list(DEVICES)}, metadata)
        self.assertEqual(original, profile)

    def test_local_provision_must_be_boolean_true(self):
        for value in (False, None, 1, "true"):
            with self.subTest(value=value):
                profile = self.profile()
                profile["LocalProvision"] = value
                self.assert_error("personal_team_profile_required", self.validate, profile)

    def test_all_devices_profile_is_rejected(self):
        profile = self.profile()
        profile["ProvisionsAllDevices"] = True
        self.assert_error("personal_team_profile_required", self.validate, profile)

    def test_team_identifier_must_be_exactly_one_expected_team(self):
        for teams in ([], ["OTHERTEAM1"], [TEAM, "OTHERTEAM1"], TEAM):
            with self.subTest(teams=teams):
                profile = self.profile()
                profile["TeamIdentifier"] = teams
                self.assert_error("profile_team_mismatch", self.validate, profile)

    def test_application_identifier_must_match_exact_team_and_bundle(self):
        for value in ("OTHERTEAM1." + BUNDLE, TEAM + "." + BUNDLE + ".other", TEAM + ".*"):
            with self.subTest(identifier=value):
                profile = self.profile()
                profile["Entitlements"]["application-identifier"] = value
                self.assert_error("profile_bundle_mismatch", self.validate, profile)

    def test_team_entitlement_must_match_configured_team(self):
        profile = self.profile()
        profile["Entitlements"]["com.apple.developer.team-identifier"] = "OTHERTEAM1"
        self.assert_error("profile_bundle_mismatch", self.validate, profile)

    def test_development_entitlement_must_be_boolean_true(self):
        for value in (False, None, 1, "true"):
            with self.subTest(value=value):
                profile = self.profile()
                profile["Entitlements"]["get-task-allow"] = value
                self.assert_error("development_profile_required", self.validate, profile)

    def test_each_of_three_required_devices_must_be_present(self):
        for missing in DEVICES:
            with self.subTest(missing=missing):
                profile = self.profile()
                profile["ProvisionedDevices"] = [device for device in DEVICES if device != missing]
                self.assert_error("profile_devices_missing", self.validate, profile)

    def test_malformed_device_inventory_is_rejected(self):
        for devices in (None, DEVICES, [*DEVICES, None]):
            with self.subTest(devices=devices):
                profile = self.profile()
                profile["ProvisionedDevices"] = devices
                self.assert_error("profile_devices_missing", self.validate, profile)

    def test_expiration_accepts_exact_48_hours_and_one_day_extension(self):
        profile = self.profile()
        profile["ExpirationDate"] = NOW + dt.timedelta(hours=48)
        result = self.validate(profile, previous_expiry=NOW + dt.timedelta(hours=24))
        self.assertEqual(sign.iso(NOW + dt.timedelta(hours=48)), result["expiresAt"])

    def test_expiration_below_48_hours_is_rejected_despite_large_extension(self):
        profile = self.profile()
        profile["ExpirationDate"] = NOW + dt.timedelta(hours=48, seconds=-1)
        self.assert_error("profile_not_renewed", self.validate, profile,
                          previous_expiry=NOW - dt.timedelta(days=1))

    def test_expiration_under_one_day_extension_is_rejected_despite_48_hour_validity(self):
        previous = NOW + dt.timedelta(days=5)
        profile = self.profile()
        profile["ExpirationDate"] = previous + dt.timedelta(days=1, seconds=-1)
        self.assert_error("profile_not_renewed", self.validate, profile, previous_expiry=previous)

    def test_naive_plist_datetimes_are_interpreted_as_utc(self):
        profile = self.profile()
        profile["CreationDate"] = profile["CreationDate"].replace(tzinfo=None)
        profile["ExpirationDate"] = profile["ExpirationDate"].replace(tzinfo=None)
        self.assertEqual(sign.iso(NOW + dt.timedelta(days=5)), self.validate(profile)["expiresAt"])

    def test_invalid_creation_dates_and_uuid_are_rejected(self):
        cases = [("CreationDate", NOW + dt.timedelta(minutes=5, seconds=1), "invalid_profile_dates"),
                 ("CreationDate", NOW + dt.timedelta(days=6), "invalid_profile_dates"),
                 ("ExpirationDate", None, "invalid_timestamp"),
                 ("UUID", "fixture-not-a-profile-uuid", "invalid_profile_uuid")]
        for field, value, error in cases:
            with self.subTest(field=field, value=value):
                profile = self.profile()
                profile[field] = value
                self.assert_error(error, self.validate, profile)


class ArchiveTests(SignerCase):
    def make_app(self):
        app = self.root / sign.APP_NAME
        app.mkdir(mode=0o755)
        executable = app / "WebDriverAgentRunner-Runner"
        executable.write_bytes(b"fixture executable\n")
        executable.chmod(0o755)
        resource = app / "Info.plist"
        resource.write_bytes(b"fixture info\n")
        resource.chmod(0o644)
        framework = app / "Frameworks" / "Fixture.framework"
        framework.mkdir(parents=True)
        framework.chmod(0o755)
        nested_executable = framework / "Fixture"
        nested_executable.write_bytes(b"fixture nested executable\n")
        nested_executable.chmod(0o751)
        return app

    def test_archive_is_byte_deterministic_and_uses_fixed_sorted_root(self):
        app = self.make_app()
        first, second = self.root / "first.zip", self.root / "second.zip"
        first_hash = sign.deterministic_archive(app, first)
        for path in [app, *app.rglob("*")]:
            os.utime(path, (1_900_000_000, 1_900_000_000))
        second_hash = sign.deterministic_archive(app, second)
        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(hashlib.sha256(first.read_bytes()).hexdigest(), first_hash)
        self.assertEqual(first_hash, second_hash)
        self.assertEqual(0o600, stat.S_IMODE(first.stat().st_mode))
        with zipfile.ZipFile(first) as archive:
            names = archive.namelist()
            self.assertEqual([sign.APP_NAME + "/",
                              sign.APP_NAME + "/Frameworks/",
                              sign.APP_NAME + "/Frameworks/Fixture.framework/",
                              sign.APP_NAME + "/Frameworks/Fixture.framework/Fixture",
                              sign.APP_NAME + "/Info.plist",
                              sign.APP_NAME + "/WebDriverAgentRunner-Runner"], names)
            self.assertTrue(all(member.date_time == (1980, 1, 1, 0, 0, 0)
                                for member in archive.infolist()))
            self.assertTrue(all(member.create_system == 3 for member in archive.infolist()))

    def test_archive_preserves_file_permissions_and_nested_executable_bits(self):
        app = self.make_app()
        archive_path = self.root / "runner.zip"
        sign.deterministic_archive(app, archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            for path in (app / "Info.plist", app / "WebDriverAgentRunner-Runner",
                         app / "Frameworks" / "Fixture.framework" / "Fixture"):
                with self.subTest(path=path.name):
                    member = archive.getinfo(sign.APP_NAME + "/" + path.relative_to(app).as_posix())
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode),
                                     stat.S_IMODE(member.external_attr >> 16))
                    self.assertTrue(stat.S_ISREG(member.external_attr >> 16))
                    self.assertEqual(path.read_bytes(), archive.read(member))

    def test_app_root_must_have_fixed_name(self):
        app = self.root / "Unexpected.app"
        app.mkdir()
        self.assert_error("invalid_app_root", sign.deterministic_archive, app, self.root / "runner.zip")
        self.assertFalse((self.root / "runner.zip").exists())

    def test_symlinked_app_root_is_rejected(self):
        target = self.root / "actual-app"
        target.mkdir()
        link = self.root / sign.APP_NAME
        link.symlink_to(target, target_is_directory=True)
        self.assert_error("symlink_path", sign.deterministic_archive, link, self.root / "runner.zip")

    def test_parent_traversal_in_app_path_is_rejected(self):
        app = self.make_app()
        intermediate = self.root / "intermediate"
        intermediate.mkdir()
        escaped = intermediate / ".." / app.name
        self.assert_error("unsafe_path", sign.deterministic_archive, escaped, self.root / "runner.zip")

    def test_archive_output_parent_traversal_is_rejected(self):
        app = self.make_app()
        intermediate = self.root / "intermediate"
        intermediate.mkdir()
        destination = intermediate / ".." / "runner.zip"
        self.assert_error("unsafe_path", sign.deterministic_archive, app, destination)
        self.assertFalse((self.root / "runner.zip").exists())

    def test_archive_output_symlink_or_symlinked_parent_is_rejected(self):
        app = self.make_app()
        outside = self.root / "outside"
        outside.mkdir()
        linked_directory = self.root / "linked-output"
        linked_directory.symlink_to(outside, target_is_directory=True)
        linked_file = self.root / "linked.zip"
        linked_file.symlink_to(outside / "runner.zip")
        for destination in (linked_directory / "runner.zip", linked_file):
            with self.subTest(destination=destination):
                self.assert_error("symlink_path", sign.deterministic_archive, app, destination)
        self.assertFalse((outside / "runner.zip").exists())

    def test_symlinked_file_or_directory_in_bundle_is_rejected(self):
        app = self.make_app()
        target = self.root / "outside"
        target.mkdir()
        (target / "secret-fixture").write_bytes(b"outside fixture")
        for directory in (False, True):
            with self.subTest(directory=directory):
                link = app / "unsafe-link"
                link.symlink_to(target if directory else target / "secret-fixture",
                                target_is_directory=directory)
                self.assert_error("unsafe_bundle_entry", sign.deterministic_archive,
                                  app, self.root / "runner.zip")
                self.assertFalse((self.root / "runner.zip").exists())
                link.unlink()

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO fixture requires a POSIX filesystem")
    def test_special_file_in_bundle_is_rejected_without_opening_it(self):
        app = self.make_app()
        os.mkfifo(app / "unsafe-fifo", mode=0o600)
        self.assert_error("unsafe_bundle_entry", sign.deterministic_archive, app, self.root / "runner.zip")
        self.assertFalse((self.root / "runner.zip").exists())


class MachOTests(SignerCase):
    @staticmethod
    def thin(filetype, endian="<", wide=False):
        magic = {("<", False): b"\xce\xfa\xed\xfe", (">", False): b"\xfe\xed\xfa\xce",
                 ("<", True): b"\xcf\xfa\xed\xfe", (">", True): b"\xfe\xed\xfa\xcf"}
        return magic[endian, wide] + struct.pack(endian + "III", 0, 0, filetype)

    @classmethod
    def fat(cls, filetypes, endian=">", wide=False):
        magic = {(">", False): b"\xca\xfe\xba\xbe", ("<", False): b"\xbe\xba\xfe\xca",
                 (">", True): b"\xca\xfe\xba\xbf", ("<", True): b"\xbf\xba\xfe\xca"}
        record_size = 32 if wide else 20
        offset = 8 + len(filetypes) * record_size
        records, architectures = [], []
        for filetype in filetypes:
            architecture = cls.thin(filetype)
            records.append(struct.pack(endian + ("IIQQII" if wide else "IIIII"),
                                       *([0, 0, offset, len(architecture), 0, 0] if wide else
                                         [0, 0, offset, len(architecture), 0])))
            architectures.append(architecture)
            offset += len(architecture)
        return magic[endian, wide] + struct.pack(endian + "I", len(filetypes)) + b"".join(records + architectures)

    def check_binary(self, content):
        path = self.root / "fixture-binary"
        path.write_bytes(content)
        return sign.runtime_macho(path)

    def test_thin_runtime_types_are_recognized_for_both_sizes_and_byte_orders(self):
        for endian in ("<", ">"):
            for wide in (False, True):
                for filetype in (2, 6, 7, 8):
                    with self.subTest(endian=endian, wide=wide, filetype=filetype):
                        self.assertTrue(self.check_binary(self.thin(filetype, endian, wide)))

    def test_dsym_object_and_non_macho_files_are_not_runtime_code(self):
        for content in (self.thin(10), self.thin(1), b"fixture resource", b""):
            with self.subTest(content=content):
                self.assertFalse(self.check_binary(content))

    def test_valid_fat32_and_fat64_inspect_each_architecture(self):
        for endian in ("<", ">"):
            for wide in (False, True):
                for types, expected in (((10, 6), True), ((10, 10), False)):
                    with self.subTest(endian=endian, wide=wide, types=types):
                        self.assertEqual(expected, self.check_binary(self.fat(types, endian, wide)))

    def test_truncated_thin_headers_are_rejected(self):
        self.assert_error("invalid_macho_header", self.check_binary, self.thin(2)[:15])

    def test_truncated_fat_header_or_architecture_table_is_rejected(self):
        for content in (self.fat((2,))[:4], self.fat((2,))[:7], self.fat((2,))[:27]):
            with self.subTest(length=len(content)):
                code = "invalid_macho_header" if len(content) < 8 else "invalid_macho_architectures"
                self.assert_error(code, self.check_binary, content)

    def test_invalid_fat_architecture_counts_are_rejected(self):
        for count in (0, 65):
            with self.subTest(count=count):
                self.assert_error("invalid_macho_architectures", self.check_binary,
                                  b"\xca\xfe\xba\xbe" + struct.pack(">I", count) + b"\0" * 8)

    def test_fat_architecture_cannot_point_into_table_or_outside_file(self):
        original = self.fat((2,))
        for offset, code in ((8, "invalid_macho_architecture_offset"),
                             (len(original), "invalid_macho_architecture")):
            with self.subTest(offset=offset):
                content = original[:16] + struct.pack(">I", offset) + original[20:]
                self.assert_error(code, self.check_binary, content)

    def test_fat_architecture_requires_a_complete_thin_macho_header(self):
        content = self.fat((2,))
        for invalid in (content[:-1], content[:-16] + b"not a macho file"):
            with self.subTest(content=invalid):
                self.assert_error("invalid_macho_architecture", self.check_binary, invalid)

    def test_invalid_second_architecture_is_rejected_after_valid_runtime_architecture(self):
        for wide in (False, True):
            with self.subTest(wide=wide):
                content = self.fat((2, 6), wide=wide)
                self.assert_error("invalid_macho_architecture", self.check_binary, content[:-16] + b"invalid arch\0\0\0\0")


class ProfileCacheTests(SignerCase):
    def setUp(self):
        super().setUp()
        self.cache = self.root / "fake-profile-cache"
        self.cache.mkdir(mode=0o700)
        self.attempt = self.root / "attempt"
        self.attempt.mkdir(mode=0o700)
        self.log = io.BytesIO()
        self.cached_profiles = {}
        self.run = mock.patch.object(sign.subprocess, "run", return_value=mock.Mock(returncode=1)).start()
        self.addCleanup(mock.patch.stopall)
        self.decode = mock.patch.object(sign, "profile_from_cms", side_effect=self.decode_fixture).start()

    def decode_fixture(self, path, log):
        return self.cached_profiles[Path(path)]

    def stale_profile(self):
        profile = self.profile()
        profile["CreationDate"] = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
        return profile

    def cached(self, name, changes=None, mode=0o644):
        path = self.cache / (name + ".mobileprovision")
        path.write_bytes(("fake profile " + name).encode())
        path.chmod(mode)
        profile = self.stale_profile()
        if changes:
            profile.update(changes)
        self.cached_profiles[path] = profile
        return path

    def refresh(self):
        return sign.ProfileCacheRefresh(self.config(), self.stale_profile(), self.attempt,
                                        self.log, roots=[self.cache])

    def test_only_exact_uuid_team_and_bundle_are_quarantined_and_commit_keeps_backups(self):
        exact = self.cached("a-exact", mode=0o640)
        originals = {exact: exact.read_bytes()}
        unrelated = [self.cached("wrong-uuid", {"UUID": "00000000-0000-0000-0000-000000000002"}),
                     self.cached("wrong-team", {"TeamIdentifier": ["OTHERTEAM1"]}),
                     self.cached("wrong-bundle", {"Entitlements": {"application-identifier": TEAM + ".other"}})]
        protected = self.cached("previous-profile")
        self.config_data["previousProfilePath"] = str(protected)
        link = self.cache / "symlink.mobileprovision"
        link.symlink_to(exact)
        untouched = {path: path.read_bytes() for path in unrelated + [protected]}
        with self.refresh() as refresh:
            self.assertFalse(exact.exists())
            self.assertTrue(link.is_symlink())
            self.assertEqual(1, len(refresh.records))
            backup = Path(refresh.records[0]["backupPath"])
            self.assertEqual(originals[exact], backup.read_bytes())
            self.assertEqual(0o600, stat.S_IMODE(backup.stat().st_mode))
            self.assertEqual(0o600, stat.S_IMODE((backup.parent / "cache-moves.json").stat().st_mode))
            refresh.commit()
        self.assertFalse(exact.exists())
        self.assertTrue(backup.is_file())
        for path, content in untouched.items():
            self.assertEqual(content, path.read_bytes())
        self.assertNotIn(protected, [call.args[0] for call in self.decode.call_args_list])

    def test_default_exit_and_failure_restore_original_bytes_and_modes(self):
        exact = self.cached("exact", mode=0o640)
        original = exact.read_bytes()
        for fail in (False, True):
            with self.subTest(failure=fail):
                attempt = self.root / ("failed-attempt" if fail else "normal-attempt")
                attempt.mkdir(mode=0o700)
                refresh = sign.ProfileCacheRefresh(self.config(), self.stale_profile(), attempt,
                                                   self.log, roots=[self.cache])
                try:
                    with refresh:
                        self.assertFalse(exact.exists())
                        if fail:
                            raise RuntimeError("fixture build failure")
                except RuntimeError:
                    self.assertTrue(fail)
                self.assertEqual(original, exact.read_bytes())
                self.assertEqual(0o640, stat.S_IMODE(exact.stat().st_mode))

    def test_rollback_does_not_clobber_a_recreated_cache_entry(self):
        changed = self.cached("a-exact", mode=0o640)
        unchanged = self.cached("b-exact", mode=0o644)
        old, other = changed.read_bytes(), unchanged.read_bytes()
        new = b"concurrent cache update"
        link = os.link

        def recreate_on_link(source, target):
            if target == changed:
                target.write_bytes(new)
                target.chmod(0o600)
            return link(source, target)

        refresh = self.refresh()
        with mock.patch.object(sign.os, "link", side_effect=recreate_on_link):
            with self.assertRaisesRegex(sign.SignError, "^profile_cache_restore_failed$"):
                with refresh:
                    self.assertFalse(changed.exists())
                    self.assertFalse(unchanged.exists())
        self.assertEqual(new, changed.read_bytes())
        self.assertEqual(0o600, stat.S_IMODE(changed.stat().st_mode))
        self.assertEqual(other, unchanged.read_bytes())
        self.assertEqual(0o644, stat.S_IMODE(unchanged.stat().st_mode))
        self.assertEqual(old, Path(refresh.records[0]["backupPath"]).read_bytes())
        self.assertEqual([], list(self.cache.glob(".wda-profile-restore-*")))

    def test_rollback_accepts_an_already_restored_original(self):
        exact = self.cached("exact", mode=0o640)
        original = exact.read_bytes()
        with self.refresh():
            exact.write_bytes(original)
            exact.chmod(0o640)
            restored_inode = exact.stat().st_ino
        self.assertEqual(original, exact.read_bytes())
        self.assertEqual(0o640, stat.S_IMODE(exact.stat().st_mode))
        self.assertEqual(restored_inode, exact.stat().st_ino)

    def test_active_xcodebuild_is_refused_before_cache_mutation(self):
        exact = self.cached("exact")
        original = exact.read_bytes()
        self.run.return_value.returncode = 0
        self.assert_error("other_xcodebuild_active", self.refresh().__enter__)
        self.assertEqual(original, exact.read_bytes())
        self.assertFalse((self.attempt / "profile-cache-backup").exists())
        self.decode.assert_not_called()
        self.run.assert_called_once_with(["/usr/bin/pgrep", "-x", "xcodebuild"],
                                         stdout=sign.subprocess.PIPE, stderr=self.log)

    def test_cache_change_before_unlink_is_preserved_and_only_removed_files_restore(self):
        first = self.cached("a-exact", mode=0o640)
        changed = self.cached("b-exact", mode=0o644)
        first_content = first.read_bytes()
        newer_content = b"new unrelated cache generation"
        write = sign.private_write

        def change_before_unlink(path, content):
            write(path, content)
            if path.name == "cache-moves.json":
                changed.write_bytes(newer_content)
                changed.chmod(0o600)

        with mock.patch.object(sign, "private_write", side_effect=change_before_unlink):
            self.assert_error("cached_profile_changed", self.refresh().__enter__)
        self.assertEqual(first_content, first.read_bytes())
        self.assertEqual(0o640, stat.S_IMODE(first.stat().st_mode))
        self.assertEqual(newer_content, changed.read_bytes())
        self.assertEqual(0o600, stat.S_IMODE(changed.stat().st_mode))


class AttemptCleanupTests(SignerCase):
    def test_pruning_keeps_twenty_including_active_and_preserves_excluded_paths(self):
        state = self.root / "state"
        state.mkdir()
        attempts = []
        for number in range(25):
            path = state / ("20300101T120000Z-" + format(number, "08x"))
            path.mkdir()
            (path / "private-log").write_bytes(b"fixture log")
            attempts.append(path)
        active = attempts[0]
        artifacts = state / "20300102T120000Z-00000000"
        artifacts.mkdir()
        (artifacts / "retained.zip").write_bytes(b"retained artifact")
        unknown = state / "unrecognized-directory"
        unknown.mkdir()
        outside = self.root / "outside-state"
        outside.mkdir()
        (outside / "retained").write_bytes(b"outside fixture")
        link = state / "20300103T120000Z-00000000"
        link.symlink_to(outside, target_is_directory=True)
        ordinary_file = state / "20300104T120000Z-00000000"
        ordinary_file.write_bytes(b"retained ordinary file")
        sign.prune_attempts(state, active, artifacts)
        self.assertEqual([attempts[0], *attempts[6:]], [path for path in attempts if path.exists()])
        self.assertEqual(b"retained artifact", (artifacts / "retained.zip").read_bytes())
        self.assertTrue(unknown.is_dir())
        self.assertTrue(link.is_symlink())
        self.assertEqual(b"outside fixture", (outside / "retained").read_bytes())
        self.assertEqual(b"retained ordinary file", ordinary_file.read_bytes())

    def test_sign_removes_derived_data_after_success_and_failure_without_removing_artifacts(self):
        config = self.config()
        config.previous_profile_path.write_bytes(b"fake previous CMS")
        config.previous_profile_path.chmod(0o600)
        config.artifact_directory.mkdir(mode=0o700)
        retained = config.artifact_directory / "retained.zip"
        retained.write_bytes(b"prior successful artifact")
        old = self.profile()
        old["CreationDate"] = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)
        old["ExpirationDate"] = config.previous_expires_at
        metadata = {"profileUUID": PROFILE_UUID, "createdAt": sign.iso(old["CreationDate"]),
                    "expiresAt": sign.iso(config.previous_expires_at + dt.timedelta(days=2)),
                    "deviceUDIDs": list(DEVICES)}
        for scenario in ("direct-success", "refresh-success", "refresh-failure", "artifact-failure"):
            with self.subTest(scenario=scenario):
                derived_paths = []

                def build(config, source, derived, log):
                    derived_paths.append(derived)
                    app = derived / "Build" / "Products" / "Debug-iphoneos" / sign.APP_NAME
                    app.mkdir(parents=True)
                    (app / "fixture-executable").write_bytes(b"fake built application")
                    return app

                refresh = mock.MagicMock()
                refresh.__enter__.return_value = refresh
                renewal = scenario.startswith("refresh-")
                results = [sign.SignError("profile_not_renewed"), metadata if scenario == "refresh-success" else
                           sign.SignError("fixture_verification_failed")] if renewal else [metadata]
                with mock.patch.multiple(sign, ensure_outside_git=mock.DEFAULT, verify_source=mock.DEFAULT,
                                         profile_from_cms=mock.DEFAULT, existing_identity=mock.DEFAULT,
                                         build_app=mock.DEFAULT, verify_app=mock.DEFAULT, command=mock.DEFAULT,
                                         ProfileCacheRefresh=mock.DEFAULT) as patched:
                    patched["verify_source"].return_value = self.project.parent
                    patched["profile_from_cms"].return_value = old
                    patched["existing_identity"].return_value = "0" * 40
                    patched["build_app"].side_effect = build
                    patched["verify_app"].side_effect = results
                    patched["ProfileCacheRefresh"].return_value = refresh
                    if scenario == "artifact-failure":
                        patched["command"].side_effect = sign.SignError("fixture_copy_verification_failed")
                    with mock.patch.object(sign.subprocess, "run", side_effect=AssertionError("unexpected process")), \
                            mock.patch.object(sign.subprocess, "Popen", side_effect=AssertionError("unexpected process")):
                        outcome = sign.sign(config)
                self.assertEqual(2 if renewal else 1, len(derived_paths))
                self.assertTrue(all(not path.exists() for path in derived_paths))
                self.assertEqual(b"prior successful artifact", retained.read_bytes())
                if scenario in ("refresh-failure", "artifact-failure"):
                    self.assertEqual("blocked", outcome["status"])
                    expected = "fixture_verification_failed" if renewal else "fixture_copy_verification_failed"
                    self.assertEqual(expected, outcome["reason"])
                    refresh.commit.assert_not_called()
                    if scenario == "artifact-failure":
                        copied = config.artifact_directory / derived_paths[0].parent.name / sign.APP_NAME
                        self.assertEqual(b"fake built application", (copied / "fixture-executable").read_bytes())
                else:
                    self.assertEqual("signed", outcome["status"])
                    manifest = json.loads(Path(outcome["manifestPath"]).read_text())
                    self.assertTrue(Path(manifest["archivePath"]).is_file())
                    self.assertEqual(b"fake built application", (Path(manifest["appPath"]) / "fixture-executable").read_bytes())
                    if scenario == "refresh-success":
                        refresh.commit.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
