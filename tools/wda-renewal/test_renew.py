"""Offline one-shot renewal controls using only synthetic private inputs."""

import contextlib
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import threading
import unittest
from unittest import mock
import warnings
import zipfile


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


worker_module = load_module("worker", "worker.py")
renew = load_module("wda_renewal_renew", "renew.py")
NOW = dt.datetime(2030, 1, 1, 12, tzinfo=dt.timezone.utc)
BUNDLE = "org.example.fixture.WebDriverAgentRunner.xctrunner"
SERIALS = ("0000000000000000000000000000000000000001",
           "0000000000000000000000000000000000000002",
           "0000000000000000000000000000000000000003")
PROFILE_UUID = "00000000-0000-0000-0000-000000000001"


class RenewalCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="wda-renew-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.state = self.root / "state"
        self.state.mkdir(mode=0o700)
        self.old_profile = self.root / "initial.mobileprovision"
        self.old_profile.write_bytes(b"fake initial CMS profile")
        self.old_profile.chmod(0o600)
        self.signer_data = {"previousProfilePath": str(self.old_profile),
                            "previousExpiresAt": renew.iso(NOW + dt.timedelta(hours=12)),
                            "buildTimeoutSeconds": 900}
        self.worker_data = {"stateDirectory": str(self.root / "workers"),
                            "minValidityHours": 48,
                            "devices": [{"serial": serial, "bundleId": BUNDLE} for serial in SERIALS]}
        self.signer_path = self.root / "signer-config.json"
        self.worker_path = self.root / "worker-config.json"
        self.write_json(self.signer_path, self.signer_data)
        self.write_json(self.worker_path, self.worker_data)
        self.config = {"version": 1, "stateDirectory": str(self.state),
                       "signerConfigPath": str(self.signer_path), "workerConfigPath": str(self.worker_path)}
        self.config_path = self.root / "renew-config.json"
        self.write_json(self.config_path, self.config)
        self.clock = mock.patch.object(renew, "now", return_value=NOW)
        self.clock.start()
        self.addCleanup(self.clock.stop)
        self.process_run = mock.patch.object(renew.subprocess, "run", side_effect=AssertionError("unexpected process"))
        self.process_run.start()
        self.addCleanup(self.process_run.stop)

    @staticmethod
    def write_json(path, value):
        if path.exists():
            path.chmod(0o600)
        path.write_text(json.dumps(value))
        path.chmod(0o600)

    def select_devices(self, count):
        self.worker_data["devices"] = self.worker_data["devices"][:count]
        self.write_json(self.worker_path, self.worker_data)

    def initial_state(self, **changes):
        state = {"pending": {}, "currentProfilePath": str(self.old_profile),
                 "currentProfileExpiresAt": self.signer_data["previousExpiresAt"]}
        state.update(changes)
        self.write_json(self.state / "service-state.json", state)
        return state

    def saved_state(self):
        return json.loads((self.state / "service-state.json").read_text())

    def device(self, **changes):
        device = {"present": True, "ready": True, "owner": None, "using": False,
                  "claimed": False, "ios": {"wda": {"expiresAt": renew.iso(NOW + dt.timedelta(hours=12))}}}
        device.update(changes)
        return device

    def fake_worker(self, device=None, result=None):
        worker = mock.Mock(spec=["device", "run"])
        worker.device.return_value = self.device() if device is None else device
        worker.run.return_value = {"status": "renewed"} if result is None else result
        return worker

    def factory(self, workers):
        def create(config, target, state_directory):
            item = workers[target["serial"]]
            if isinstance(item, Exception):
                raise item
            return item
        return mock.Mock(side_effect=create)

    def artifact(self, suffix=""):
        app = self.root / ("fake-signed" + suffix + ".app")
        app.mkdir(exist_ok=True, mode=0o700)
        (app / "embedded.mobileprovision").write_bytes(b"fake renewed CMS profile")
        (app / "embedded.mobileprovision").chmod(0o600)
        archive = self.root / ("fake" + suffix + ".zip")
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("WebDriverAgentRunner-Runner.app/embedded.mobileprovision", b"fake renewed CMS profile")
        archive.chmod(0o600)
        manifest = {"version": 1, "bundleId": BUNDLE, "profileUUID": PROFILE_UUID,
                    "deviceUDIDs": list(SERIALS), "expiresAt": renew.iso(NOW + dt.timedelta(days=7)),
                    "appPath": str(app), "archivePath": str(archive),
                    "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "sourceSHA": "0" * 40}
        path = self.root / ("manifest" + suffix + ".json")
        self.write_json(path, manifest)
        return path, manifest

    def fake_signer(self, manifest_path, manifest):
        def publish(config, state, state_directory):
            state["manifestPath"] = str(manifest_path)
            self.write_json(state_directory / "service-state.json", state)
            return manifest
        return mock.Mock(side_effect=publish)


class CycleTests(RenewalCase):
    def test_active_operation_lock_refuses_cycle_before_worker_or_signer(self):
        self.select_devices(1)
        factory = self.factory({SERIALS[0]: self.fake_worker()})
        signer = mock.Mock(side_effect=AssertionError("active cycle must not sign"))
        with renew.operation_lock(self.state):
            with self.assertRaises(worker_module.RenewalError) as caught:
                renew.cycle(self.config, factory, signer)
        self.assertEqual("renewal_active", str(caught.exception))
        factory.assert_not_called()
        signer.assert_not_called()

    def test_not_due_offline_not_ready_and_missing_expiry_never_sign_or_run(self):
        self.worker_data["devices"].append({"serial": "0000000000000000000000000000000000000004", "bundleId": BUNDLE})
        self.write_json(self.worker_path, self.worker_data)
        devices = [self.device(ios={"wda": {"expiresAt": renew.iso(NOW + dt.timedelta(hours=49))}}),
                   self.device(present=False), self.device(ready=False), self.device(ios={})]
        workers = {target["serial"]: self.fake_worker(device) for target, device in zip(self.worker_data["devices"], devices)}
        signer = mock.Mock(side_effect=AssertionError("signing must be skipped"))
        status = renew.cycle(self.config, self.factory(workers), signer)
        self.assertEqual((1, 3, 0, 0), (status["notDue"], status["offline"], status["failed"], status["renewed"]))
        signer.assert_not_called()
        for worker in workers.values():
            worker.run.assert_not_called()
        self.assertNotIn("nextCheckAt", status)

    def test_missing_device_is_offline_and_constructor_error_does_not_stop_other_devices(self):
        missing = self.fake_worker()
        missing.device.side_effect = worker_module.RenewalError("device_missing")
        not_due = self.fake_worker(self.device(ios={"wda": {"expiresAt": renew.iso(NOW + dt.timedelta(days=4))}}))
        workers = {SERIALS[0]: worker_module.RenewalError("fixture_constructor_failed"),
                   SERIALS[1]: missing, SERIALS[2]: not_due}
        signer = mock.Mock(side_effect=AssertionError("signing must be skipped"))
        status = renew.cycle(self.config, self.factory(workers), signer)
        self.assertEqual((1, 1, 1, 0), (status["failed"], status["offline"], status["notDue"], status["renewed"]))
        self.assertIn("fixture_constructor_failed", status["errors"])
        signer.assert_not_called()
        not_due.device.assert_called_once_with()

    def test_manual_owner_is_skipped_and_automation_owner_can_drain_in_worker(self):
        self.select_devices(2)
        manual = self.fake_worker(self.device(owner={"email": "fixture@example.invalid"}, using=True, usage="manual"))
        automation = self.fake_worker(self.device(owner={"email": "automation@example.invalid"}, using=True,
                                                  claimed=True, usage="automation"))
        path, manifest = self.artifact()
        signer = self.fake_signer(path, manifest)
        status = renew.cycle(self.config, self.factory({SERIALS[0]: manual, SERIALS[1]: automation}), signer)
        self.assertEqual((1, 1, 0), (status["busy"], status["renewed"], status["failed"]))
        manual.run.assert_not_called()
        automation.run.assert_called_once_with(manifest)
        signer.assert_called_once()

    def test_cached_artifact_is_reused_for_each_due_device(self):
        self.select_devices(2)
        path, manifest = self.artifact()
        self.initial_state(manifestPath=str(path))
        workers = {serial: self.fake_worker() for serial in SERIALS[:2]}
        signer = mock.Mock(side_effect=AssertionError("cached artifact must be reused"))
        status = renew.cycle(self.config, self.factory(workers), signer)
        self.assertEqual((2, 0), (status["renewed"], status["failed"]))
        signer.assert_not_called()
        for worker in workers.values():
            worker.run.assert_called_once_with(manifest)
        self.assertEqual({}, self.saved_state()["pending"])

    def test_one_worker_run_failure_does_not_stop_the_next_device(self):
        self.select_devices(2)
        path, manifest = self.artifact()
        failed = self.fake_worker()
        failed.run.side_effect = worker_module.RenewalError("fixture_install_failed")
        succeeded = self.fake_worker()
        signer = self.fake_signer(path, manifest)
        status = renew.cycle(self.config, self.factory({SERIALS[0]: failed, SERIALS[1]: succeeded}), signer)
        self.assertEqual((1, 1), (status["failed"], status["renewed"]))
        self.assertIn("fixture_install_failed", status["errors"])
        succeeded.run.assert_called_once_with(manifest)
        self.assertEqual({SERIALS[0]: str(path)}, self.saved_state()["pending"])
        signer.assert_called_once()

    def test_failed_pending_install_resumes_same_artifact_without_fresh_device_probe_or_signing(self):
        self.select_devices(1)
        before = self.initial_state()
        path, manifest = self.artifact()
        worker = self.fake_worker()
        worker.run.side_effect = worker_module.RenewalError("fixture_install_failed")
        factory = self.factory({SERIALS[0]: worker})
        signer = self.fake_signer(path, manifest)
        first = renew.cycle(self.config, factory, signer)
        self.assertEqual((1, 0), (first["failed"], first["renewed"]))
        pending = self.saved_state()
        self.assertEqual({SERIALS[0]: str(path)}, pending["pending"])
        self.assertEqual(before["currentProfilePath"], pending["currentProfilePath"])
        self.assertEqual(before["currentProfileExpiresAt"], pending["currentProfileExpiresAt"])
        worker.reset_mock()
        worker.device.side_effect = AssertionError("pending recovery must not require provider readiness")
        worker.run.side_effect = None
        worker.run.return_value = {"status": "renewed"}
        signer.reset_mock()
        second = renew.cycle(self.config, factory, signer)
        self.assertEqual((0, 1), (second["failed"], second["renewed"]))
        worker.device.assert_not_called()
        worker.run.assert_called_once_with(manifest)
        signer.assert_not_called()
        after = self.saved_state()
        self.assertEqual({}, after["pending"])
        self.assertEqual(manifest["expiresAt"], after["currentProfileExpiresAt"])
        self.assertNotEqual(before["currentProfilePath"], after["currentProfilePath"])
        retained = Path(after["currentProfilePath"])
        self.assertEqual(b"fake renewed CMS profile", retained.read_bytes())
        self.assertEqual(0o600, stat.S_IMODE(retained.stat().st_mode))
        self.assertEqual(b"fake initial CMS profile", self.old_profile.read_bytes())

    def test_nonrenewed_worker_status_cannot_advance_signer_baseline(self):
        self.select_devices(1)
        before = self.initial_state()
        path, manifest = self.artifact()
        worker = self.fake_worker(result={"status": "blocked"})
        status = renew.cycle(self.config, self.factory({SERIALS[0]: worker}), self.fake_signer(path, manifest))
        after = self.saved_state()
        self.assertEqual((1, 0), (status["failed"], status["renewed"]))
        self.assertEqual(before["currentProfilePath"], after["currentProfilePath"])
        self.assertEqual(before["currentProfileExpiresAt"], after["currentProfileExpiresAt"])
        self.assertNotIn("lastSuccessAt", after)
        self.assertEqual({SERIALS[0]: str(path)}, after["pending"])

    def test_signer_failure_never_runs_worker_or_reports_success(self):
        self.select_devices(1)
        before = self.initial_state()
        worker = self.fake_worker()
        signer = mock.Mock(side_effect=worker_module.RenewalError("signer_fixture_failed"))
        status = renew.cycle(self.config, self.factory({SERIALS[0]: worker}), signer)
        self.assertEqual((1, 0), (status["failed"], status["renewed"]))
        self.assertIn("signer_fixture_failed", status["errors"])
        worker.run.assert_not_called()
        after = self.saved_state()
        for key, value in before.items():
            self.assertEqual(value, after[key])
        self.assertNotIn("lastSuccessAt", after)

    def test_stop_requested_by_first_worker_prevents_starting_the_next_device(self):
        self.select_devices(2)
        path, manifest = self.artifact()
        stop = threading.Event()
        first = self.fake_worker()
        second = self.fake_worker()

        def finish_and_stop(artifact):
            stop.set()
            return {"status": "renewed"}

        first.run.side_effect = finish_and_stop
        factory = self.factory({SERIALS[0]: first, SERIALS[1]: second})
        signer = self.fake_signer(path, manifest)
        status = renew.cycle(self.config, factory, signer, stop_event=stop)
        self.assertEqual((1, 1), (status["renewed"], status["failed"]))
        self.assertEqual(["renewal_interrupted"], status["errors"])
        self.assertEqual(1, factory.call_count)
        first.run.assert_called_once_with(manifest)
        second.device.assert_not_called()
        second.run.assert_not_called()
        signer.assert_called_once()

    def test_expired_wda_recovery_requires_explicit_flag_and_expired_profile_proof(self):
        self.select_devices(1)
        path, manifest = self.artifact()
        cases = [(False, "expired", -1, False), (True, "valid", -1, False),
                 (True, "expired", 1, False), (True, "expired", -1, True)]
        for enabled, profile, hours, recover in cases:
            with self.subTest(enabled=enabled, profile=profile, hours=hours):
                self.initial_state()
                self.worker_data["allowExpiredWdaRecovery"] = enabled
                self.write_json(self.worker_path, self.worker_data)
                device = self.device(ready=False, ios={"wda": {"profile": profile,
                                     "expiresAt": renew.iso(NOW + dt.timedelta(hours=hours))}})
                worker = self.fake_worker(device)
                signer = self.fake_signer(path, manifest)
                status = renew.cycle(self.config, self.factory({SERIALS[0]: worker}), signer)
                self.assertEqual((0, 1, 0) if recover else (1, 0, 0),
                                 (status["offline"], status["renewed"], status["failed"]))
                if recover:
                    worker.run.assert_called_once_with(manifest)
                    signer.assert_called_once()
                else:
                    worker.run.assert_not_called()
                    signer.assert_not_called()

    def test_accepted_install_with_failed_baseline_copy_retries_copy_without_reinstalling(self):
        self.select_devices(1)
        before = self.initial_state()
        path, manifest = self.artifact()
        worker = self.fake_worker()
        factory = self.factory({SERIALS[0]: worker})
        signer = self.fake_signer(path, manifest)
        with mock.patch.object(renew, "retain_profile", side_effect=worker_module.RenewalError("fixture_profile_copy_failed")):
            first = renew.cycle(self.config, factory, signer)
        self.assertEqual((1, 0), (first["failed"], first["renewed"]))
        self.assertEqual({SERIALS[0]: str(path)}, self.saved_state()["accepted"])
        self.assertEqual(before["currentProfilePath"], self.saved_state()["currentProfilePath"])
        worker.reset_mock()
        worker.device.side_effect = AssertionError("accepted recovery must not probe device")
        worker.run.side_effect = AssertionError("accepted recovery must not reinstall")
        signer.reset_mock()
        second = renew.cycle(self.config, factory, signer)
        self.assertEqual((0, 1), (second["failed"], second["renewed"]))
        worker.device.assert_not_called()
        worker.run.assert_not_called()
        signer.assert_not_called()
        self.assertEqual(manifest["expiresAt"], self.saved_state()["currentProfileExpiresAt"])
        self.assertNotIn(SERIALS[0], self.saved_state().get("accepted", {}))
        self.assertNotIn(SERIALS[0], self.saved_state()["pending"])

    def test_invalid_pending_artifact_is_retained_for_recovery_without_signing(self):
        self.select_devices(1)
        missing = self.root / "missing-manifest.json"
        self.initial_state(pending={SERIALS[0]: str(missing)})
        worker = self.fake_worker()
        signer = mock.Mock(side_effect=AssertionError("pending artifact must not be replaced"))
        status = renew.cycle(self.config, self.factory({SERIALS[0]: worker}), signer)
        self.assertEqual((1, 0), (status["failed"], status["renewed"]))
        self.assertEqual({SERIALS[0]: str(missing)}, self.saved_state()["pending"])
        worker.device.assert_not_called()
        worker.run.assert_not_called()
        signer.assert_not_called()

    def test_invalid_cached_artifact_can_be_replaced_by_signer(self):
        self.select_devices(1)
        self.initial_state(manifestPath=str(self.root / "missing-cache.json"))
        path, manifest = self.artifact()
        signer = self.fake_signer(path, manifest)
        status = renew.cycle(self.config, self.factory({SERIALS[0]: self.fake_worker()}), signer)
        self.assertEqual((0, 1), (status["failed"], status["renewed"]))
        signer.assert_called_once()

    def test_corrupted_cached_archive_is_replaced_instead_of_reused(self):
        self.select_devices(1)
        cached_path, cached = self.artifact("-cached")
        replacement_path, replacement = self.artifact("-replacement")
        self.initial_state(manifestPath=str(cached_path))
        Path(cached["archivePath"]).write_bytes(b"corrupted synthetic archive")
        worker = self.fake_worker()
        signer = self.fake_signer(replacement_path, replacement)
        status = renew.cycle(self.config, self.factory({SERIALS[0]: worker}), signer)
        self.assertEqual((0, 1), (status["failed"], status["renewed"]))
        signer.assert_called_once()
        worker.run.assert_called_once_with(replacement)
        self.assertEqual(str(replacement_path), self.saved_state()["manifestPath"])

    def test_signing_uses_only_the_accepted_baseline_for_next_invocation(self):
        accepted = self.root / "accepted.mobileprovision"
        accepted.write_bytes(b"fake already accepted CMS profile")
        accepted.chmod(0o600)
        state = self.initial_state(currentProfilePath=str(accepted),
                                   currentProfileExpiresAt=renew.iso(NOW + dt.timedelta(days=3)))
        path, manifest = self.artifact()
        response = {"status": "signed", "manifestPath": str(path)}
        with mock.patch.object(renew.subprocess, "run", return_value=mock.Mock(returncode=0, stdout=json.dumps(response))):
            self.assertEqual(manifest, renew.signing(self.config, state, self.state))
        invocation = json.loads((self.state / "signer-invocation.json").read_text())
        self.assertEqual(state["currentProfilePath"], invocation["previousProfilePath"])
        self.assertEqual(state["currentProfileExpiresAt"], invocation["previousExpiresAt"])
        self.assertEqual(self.signer_data, json.loads(self.signer_path.read_text()))

    def test_accepting_an_older_device_install_cannot_regress_a_newer_signer_baseline(self):
        state = self.initial_state(currentProfileExpiresAt=renew.iso(NOW + dt.timedelta(days=8)))
        before = dict(state)
        _, manifest = self.artifact()
        renew.retain_profile(state, manifest, self.state)
        self.assertEqual(before, state)
        self.assertEqual(b"fake initial CMS profile", Path(state["currentProfilePath"]).read_bytes())

    def test_retained_baseline_uses_checked_archive_when_app_directory_has_drifted(self):
        state = self.initial_state()
        _, manifest = self.artifact()
        app_profile = Path(manifest["appPath"]) / "embedded.mobileprovision"
        app_profile.write_bytes(b"untrusted app directory drift")
        renew.retain_profile(state, manifest, self.state)
        self.assertEqual(b"fake renewed CMS profile", Path(state["currentProfilePath"]).read_bytes())
        self.assertEqual(manifest["expiresAt"], state["currentProfileExpiresAt"])
        self.assertEqual(b"untrusted app directory drift", app_profile.read_bytes())

    def test_archive_changed_after_worker_acceptance_keeps_pending_and_baseline_unchanged(self):
        self.select_devices(1)
        before = self.initial_state()
        path, manifest = self.artifact()
        worker = self.fake_worker()

        def accept_then_corrupt(artifact):
            Path(artifact["archivePath"]).write_bytes(b"corrupted after accepted installation")
            return {"status": "renewed"}

        worker.run.side_effect = accept_then_corrupt
        factory = self.factory({SERIALS[0]: worker})
        signer = self.fake_signer(path, manifest)
        first = renew.cycle(self.config, factory, signer)
        self.assertEqual((1, 0), (first["failed"], first["renewed"]))
        worker.reset_mock()
        signer.reset_mock()
        second = renew.cycle(self.config, factory, signer)
        self.assertEqual((1, 0), (second["failed"], second["renewed"]))
        worker.device.assert_not_called()
        worker.run.assert_not_called()
        signer.assert_not_called()
        state = self.saved_state()
        self.assertEqual({SERIALS[0]: str(path)}, state["pending"])
        self.assertEqual({SERIALS[0]: str(path)}, state["accepted"])
        self.assertEqual(before["currentProfilePath"], state["currentProfilePath"])
        self.assertEqual(before["currentProfileExpiresAt"], state["currentProfileExpiresAt"])
        self.assertFalse((self.state / ("current-" + PROFILE_UUID + ".mobileprovision")).exists())

    def test_duplicate_profile_entries_in_archive_cannot_publish_a_baseline(self):
        state = self.initial_state()
        before = dict(state)
        _, manifest = self.artifact()
        archive = Path(manifest["archivePath"])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(archive, "w") as zipped:
                for content in (b"first fake profile", b"second fake profile"):
                    zipped.writestr("WebDriverAgentRunner-Runner.app/embedded.mobileprovision", content)
        manifest["archiveSha256"] = hashlib.sha256(archive.read_bytes()).hexdigest()
        with self.assertRaises(worker_module.RenewalError):
            renew.retain_profile(state, manifest, self.state)
        self.assertEqual(before, state)

    def test_invalid_or_failed_signer_response_does_not_publish_an_artifact(self):
        responses = [(1, {"status": "signed", "manifestPath": "fake"}),
                     (0, {"status": "blocked", "reason": "fixture_failed"}), (0, "invalid json")]
        for returncode, response in responses:
            with self.subTest(returncode=returncode, response=response):
                state = self.initial_state()
                stdout = response if isinstance(response, str) else json.dumps(response)
                with mock.patch.object(renew.subprocess, "run", return_value=mock.Mock(returncode=returncode, stdout=stdout)):
                    with self.assertRaises(worker_module.RenewalError):
                        renew.signing(self.config, state, self.state)
                self.assertNotIn("manifestPath", state)
                self.assertNotIn("manifestPath", self.saved_state())


class ConfigTests(RenewalCase):
    def test_default_and_boundary_configurations_are_valid(self):
        self.assertIsInstance(renew.validate_config(self.config), dict)
        for threshold in (48, 120):
            with self.subTest(threshold=threshold):
                value = dict(self.config, renewBeforeHours=threshold)
                self.assertIsInstance(renew.validate_config(value), dict)

    def test_threshold_requires_an_integer_value_in_range(self):
        for value in (True, False, "48", 48.0, 47, 121):
            with self.subTest(value=value):
                with self.assertRaises(worker_module.RenewalError):
                    renew.validate_config(dict(self.config, renewBeforeHours=value))

    def test_scheduling_configuration_is_rejected(self):
        with self.assertRaises(worker_module.RenewalError):
            renew.validate_config(dict(self.config, checkIntervalSeconds=3600))

    def test_config_rejects_unknown_missing_and_noninteger_version(self):
        missing = dict(self.config)
        del missing["workerConfigPath"]
        for value in (dict(self.config, version=True), dict(self.config, version=2),
                      dict(self.config, extraSetting=True), missing, [], None):
            with self.subTest(value=value):
                with self.assertRaises(worker_module.RenewalError):
                    renew.validate_config(value)

    def test_config_paths_reject_relative_parent_traversal_and_symlinked_components(self):
        link = self.root / "linked-root"
        link.symlink_to(self.root, target_is_directory=True)
        for field in ("stateDirectory", "signerConfigPath", "workerConfigPath"):
            for path in ("relative", str(self.root / "child" / ".." / "target"), str(link / "target")):
                with self.subTest(field=field, path=path):
                    with self.assertRaises(worker_module.RenewalError):
                        renew.validate_config(dict(self.config, **{field: path}))

    def test_nested_config_files_require_exactly_0600(self):
        for path in (self.signer_path, self.worker_path):
            for mode in (0o400, 0o640, 0o644):
                with self.subTest(path=path.name, mode=oct(mode)):
                    path.chmod(mode)
                    with self.assertRaises(worker_module.RenewalError):
                        renew.validate_config(self.config)
                    path.chmod(0o600)


class ArtifactRetentionTests(RenewalCase):
    def test_retention_preserves_latest_three_and_current_pending_accepted_and_active_journal(self):
        published = self.root / "published"
        published.mkdir(mode=0o700)
        self.signer_data["artifactDirectory"] = str(published)
        self.write_json(self.signer_path, self.signer_data)
        _, base = self.artifact()
        releases, manifests = [], []
        for number in range(10):
            directory = published / ("20300101T120000Z-" + format(number, "08x"))
            directory.mkdir(mode=0o700)
            app = directory / "WebDriverAgentRunner-Runner.app"
            app.mkdir(mode=0o700)
            archive = directory / "WebDriverAgentRunner-Runner.app.zip"
            archive.write_bytes(("published fixture " + str(number)).encode())
            archive.chmod(0o600)
            manifest = dict(base, appPath=str(app), archivePath=str(archive),
                            archiveSha256=hashlib.sha256(archive.read_bytes()).hexdigest())
            self.write_json(directory / "manifest.json", manifest)
            releases.append(directory)
            manifests.append(manifest)
        worker_state = Path(self.worker_data["stateDirectory"])
        worker_state.mkdir(mode=0o700)
        self.write_json(worker_state / (SERIALS[0] + ".json"),
                        {"completed": False, "archiveSha256": manifests[3]["archiveSha256"]})
        self.write_json(worker_state / (SERIALS[1] + ".json"),
                        {"completed": True, "archiveSha256": manifests[4]["archiveSha256"]})
        state = {"manifestPath": str(releases[0] / "manifest.json"),
                 "pending": {SERIALS[0]: str(releases[1] / "manifest.json")},
                 "accepted": {SERIALS[1]: str(releases[2] / "manifest.json")}}
        unrecognized = published / "unrecognized-directory"
        unrecognized.mkdir()
        incomplete = published / "20300102T120000Z-00000000"
        incomplete.mkdir()
        outside = self.root / "outside-published"
        outside.mkdir()
        marker = outside / "retained"
        marker.write_bytes(b"outside fixture")
        link = published / "20300103T120000Z-00000000"
        link.symlink_to(outside, target_is_directory=True)
        renew.prune_artifacts(self.config, state, self.worker_data)
        self.assertEqual([0, 1, 2, 3, 7, 8, 9], [number for number, path in enumerate(releases) if path.exists()])
        self.assertTrue(unrecognized.is_dir())
        self.assertTrue(incomplete.is_dir())
        self.assertTrue(link.is_symlink())
        self.assertEqual(b"outside fixture", marker.read_bytes())


class CommandTests(RenewalCase):
    def invoke(self, *arguments):
        output = io.StringIO()
        with mock.patch.object(sys, "argv", ["renew.py", "--config", str(self.config_path), *arguments]), \
                mock.patch.object(renew.signal, "signal"), \
                mock.patch.object(renew.os, "umask", return_value=0o022), contextlib.redirect_stdout(output):
            result = renew.main()
        return result, json.loads(output.getvalue())

    def test_default_command_runs_one_cycle_and_exits(self):
        status = {"checkedAt": renew.iso(NOW), "renewed": 0, "notDue": 3, "failed": 0}
        with mock.patch.object(renew, "cycle", return_value=status) as cycle:
            result, response = self.invoke()
        self.assertEqual(0, result)
        self.assertEqual(status, response)
        cycle.assert_called_once()
        self.assertNotIn("nextCheckAt", response)

    def test_failed_cycle_returns_nonzero_and_preserves_error_reason(self):
        status = {"failed": 1, "errors": ["fixture_install_failed"]}
        with mock.patch.object(renew, "cycle", return_value=status) as cycle:
            result, response = self.invoke()
        self.assertEqual(1, result)
        self.assertEqual(status, response)
        cycle.assert_called_once()

    def test_offline_or_busy_target_returns_nonzero_even_after_partial_success(self):
        for skipped in ("offline", "busy"):
            with self.subTest(skipped=skipped):
                status = {"renewed": 1, "notDue": 1, "failed": 0, skipped: 1}
                with mock.patch.object(renew, "cycle", return_value=status) as cycle:
                    result, response = self.invoke()
                self.assertEqual(1, result)
                self.assertEqual(status, response)
                cycle.assert_called_once()

    def test_status_reads_previous_result_without_a_cycle_or_external_process(self):
        status = {"checkedAt": renew.iso(NOW), "renewed": 1, "failed": 0}
        self.write_json(self.state / "status.json", status)
        with mock.patch.object(renew, "cycle", side_effect=AssertionError("status must stay local")) as cycle:
            result, response = self.invoke("--status")
        self.assertEqual(0, result)
        self.assertEqual(status, response)
        cycle.assert_not_called()

    def test_competing_invocation_fails_without_overwriting_active_command_status(self):
        before = {"checkedAt": renew.iso(NOW), "renewed": 1, "failed": 0}
        self.write_json(self.state / "status.json", before)
        with mock.patch.object(renew, "cycle", side_effect=worker_module.RenewalError("renewal_active")):
            result, response = self.invoke()
        self.assertEqual(1, result)
        self.assertEqual(["renewal_active"], response["errors"])
        self.assertEqual(before, json.loads((self.state / "status.json").read_text()))

    def test_command_exception_returns_nonzero_and_writes_sanitized_status(self):
        with mock.patch.object(renew, "cycle", side_effect=RuntimeError("private synthetic details")):
            result, response = self.invoke()
        self.assertEqual(1, result)
        self.assertEqual(["operation_failed"], response["errors"])
        self.assertEqual(response, json.loads((self.state / "status.json").read_text()))


if __name__ == "__main__":
    unittest.main()
