import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("ios_device", Path(__file__).with_name("ios-device.py"))
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
UDID = "11111111-2222-3333-4444-555555555555"
OTHER = "99999999-2222-3333-4444-555555555555"
RUNTIME = "com.apple.CoreSimulator.SimRuntime.iOS-26-0"
IPHONE = "com.apple.CoreSimulator.SimDeviceType.iPhone-17"
IPAD = "com.apple.CoreSimulator.SimDeviceType.iPad-Pro"


def inventory(state="Booted", available=True, name=None):
    return {"runtimes": [{"identifier": RUNTIME, "name": "iOS 26.0", "version": "26.0", "isAvailable": available},
                         {"identifier": "com.apple.CoreSimulator.SimRuntime.tvOS-26-0", "isAvailable": True}],
            "devicetypes": [{"identifier": IPHONE, "name": "iPhone 17", "productFamily": "iPhone"},
                            {"identifier": IPAD, "name": "iPad Pro", "productFamily": "iPad"}],
            "devices": {RUNTIME: [{"udid": UDID, "name": name or "creator-qa-ios-compact-phone", "state": state, "isAvailable": available}]}}


class IosDeviceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.registry = self.root / "ios-managed/registry.json"
        self.tools = {"simctl": "/fixture/Xcode.app/simctl", "env": {"DEVELOPER_DIR": "/fixture/Xcode.app/Contents/Developer"}, "developerDir": "/fixture/Xcode.app/Contents/Developer"}
        self.patches = [patch.object(qa, "OUTPUT", self.root), patch.object(qa, "REGISTRY", self.registry)]
        for p in self.patches:
            p.start()
        self.addCleanup(self.temporary.cleanup)
        self.addCleanup(lambda: [p.stop() for p in reversed(self.patches)])

    def register(self):
        self.registry.parent.mkdir()
        self.registry.write_text(json.dumps({"schemaVersion": 1, "devices": {UDID: {
            "name": "creator-qa-ios-compact-phone", "runtime": RUNTIME}}}))

    def test_non_macos_is_not_ready_and_does_not_invoke_xcode(self):
        with patch.object(qa.platform, "system", return_value="Linux"), patch.object(qa, "run") as run:
            tools = qa.xcode_tools()
            self.assertFalse(qa.doctor(tools)["ready"])
            run.assert_not_called()

    def test_missing_xcode_and_clt_do_not_count_as_simulator(self):
        selected = subprocess.CompletedProcess([], 0, "/Library/Developer/CommandLineTools\n", "")
        with patch.object(qa.platform, "system", return_value="Darwin"), patch.object(qa, "run", return_value=selected), patch.object(Path, "is_dir", return_value=False):
            result = qa.doctor(qa.xcode_tools())
        self.assertFalse(result["ready"])
        self.assertIsNone(result["simctl"])
        self.assertIn("Command Line Tools", result["reason"])
        self.assertEqual(result["installUrl"], "https://developer.apple.com/xcode/")

    def test_selected_xcode_is_passed_only_to_child_environment(self):
        developer = self.root / "Xcode.app/Contents/Developer"
        (developer / "Applications/Simulator.app").mkdir(parents=True)
        simulator = developer / "usr/bin/simctl"
        simulator.parent.mkdir(parents=True)
        simulator.write_text("fixture")
        simulator.chmod(0o700)
        with patch.object(qa.platform, "system", return_value="Darwin"), patch.dict(os.environ, {"DEVELOPER_DIR": str(developer)}), patch.object(qa, "run", return_value=subprocess.CompletedProcess([], 0, str(simulator) + "\n", "")) as run:
            before = os.environ.copy()
            result = qa.xcode_tools()
            self.assertEqual(result["env"]["DEVELOPER_DIR"], str(developer.resolve()))
            self.assertEqual(os.environ, before)
            self.assertEqual(run.call_args.args[0], ["/usr/bin/xcrun", "--find", "simctl"])

    def test_doctor_excludes_unavailable_and_non_ios_runtimes(self):
        with patch.object(qa, "inventory", return_value=inventory(available=False)):
            result = qa.doctor(self.tools)
        self.assertFalse(result["ready"])
        self.assertEqual(result["runtimes"], [])

    def test_doctor_ready_requires_installed_ios_and_iphone_type(self):
        with patch.object(qa, "inventory", return_value=inventory()):
            result = qa.doctor(self.tools)
        self.assertTrue(result["ready"])
        self.assertEqual([r["identifier"] for r in result["runtimes"]], [RUNTIME])

    def test_invalid_simctl_json_is_not_reported_as_empty_success(self):
        with patch.object(qa, "simctl", return_value=subprocess.CompletedProcess([], 0, "{}", "")):
            with self.assertRaisesRegex(qa.QAError, "完整"):
                qa.inventory(self.tools)

    def test_implicit_booted_and_shell_fragments_are_rejected(self):
        for value in ["booted", "iPhone 17", "", "--help", UDID + ";echo unsafe"]:
            with self.subTest(value=value), self.assertRaises(qa.QAError):
                qa.valid_udid(value)

    def test_unregistered_udid_cannot_target_existing_user_device(self):
        with patch.object(qa, "inventory") as get:
            with self.assertRaisesRegex(qa.QAError, "未登记"):
                qa.managed_device(self.tools, OTHER)
            get.assert_not_called()

    def test_registry_device_name_and_runtime_must_match_live_inventory(self):
        self.register()
        for data in [inventory(name="my-personal-iphone"), {**inventory(), "devices": {"other-runtime": inventory()["devices"][RUNTIME]}}]:
            with self.subTest(data=data), self.assertRaisesRegex(qa.QAError, "身份不匹配"):
                qa.managed_device(self.tools, UDID, data)

    def test_missing_runtime_and_unbooted_devices_are_rejected_without_mutation(self):
        self.register()
        with self.assertRaisesRegex(qa.QAError, "runtime 不可用"):
            qa.managed_device(self.tools, UDID, inventory(available=False))
        with self.assertRaisesRegex(qa.QAError, "未启动"):
            qa.managed_device(self.tools, UDID, inventory(state="Shutdown"), require_booted=True)

    def test_registry_symlink_and_corrupt_data_fail_closed(self):
        self.registry.parent.mkdir()
        target = self.root / "other.json"
        target.write_text("{}")
        self.registry.symlink_to(target)
        with self.assertRaisesRegex(qa.QAError, "符号链接"):
            qa.registry()
        self.registry.unlink()
        self.registry.write_text("bad json")
        with self.assertRaisesRegex(qa.QAError, "损坏"):
            qa.registry()

    def test_create_requires_observed_type_runtime_and_correct_family(self):
        data = inventory()
        data["devices"] = {}
        with patch.object(qa, "inventory", return_value=data), patch.object(qa, "simctl") as call:
            for device, runtime in [("invented", RUNTIME), (IPHONE, "missing"), (IPAD, RUNTIME)]:
                with self.subTest(device=device, runtime=runtime), self.assertRaises(qa.QAError):
                    qa.create(self.tools, "compact-phone", device, runtime)
            call.assert_not_called()

    def test_create_never_overwrites_existing_name_or_save_data(self):
        with patch.object(qa, "inventory", return_value=inventory()), patch.object(qa, "simctl") as call:
            with self.assertRaisesRegex(qa.QAError, "保留旧设备与存档"):
                qa.create(self.tools, "compact-phone", IPHONE, RUNTIME)
            call.assert_not_called()

    def test_create_records_actual_returned_udid_and_no_destructive_commands(self):
        empty = inventory()
        empty["devices"] = {}
        with patch.object(qa, "inventory", side_effect=[empty, inventory()]), patch.object(qa, "simctl", return_value=subprocess.CompletedProcess([], 0, UDID.lower() + "\n", "")) as call:
            result = qa.create(self.tools, "compact-phone", IPHONE, RUNTIME)
        self.assertEqual(result["udid"], UDID)
        call.assert_called_once_with(self.tools, "create", "creator-qa-ios-compact-phone", IPHONE, RUNTIME, timeout=120)
        self.assertEqual(json.loads(self.registry.read_text())["devices"][UDID]["deviceType"], IPHONE)
        self.assertFalse((self.registry.parent / ".create.lock").exists())

    def test_existing_creation_lock_is_preserved(self):
        self.registry.parent.mkdir()
        lock = self.registry.parent / ".create.lock"
        lock.write_text("other job")
        with self.assertRaisesRegex(qa.QAError, "锁存在"):
            with qa.registry_lock():
                self.fail("must not acquire")
        self.assertEqual(lock.read_text(), "other job")

    def test_boot_uses_explicit_owned_udid_and_bounded_bootstatus(self):
        self.register()
        with patch.object(qa, "inventory", side_effect=[inventory(state="Shutdown"), inventory()]), patch.object(qa, "simctl") as call:
            result = qa.boot(self.tools, UDID, 180)
        self.assertTrue(result["bootCompleted"])
        self.assertEqual(call.call_args_list[0].args, (self.tools, "boot", UDID))
        self.assertEqual(call.call_args_list[1].args, (self.tools, "bootstatus", UDID, "-b"))
        self.assertEqual(call.call_args_list[1].kwargs["timeout"], 180)

    def test_boot_timeout_preserves_device_and_registry(self):
        self.register()
        before = self.registry.read_bytes()
        with patch.object(qa, "inventory", return_value=inventory()), patch.object(qa, "simctl", side_effect=qa.QAError("boot timeout")) as call:
            with self.assertRaises(qa.QAError):
                qa.boot(self.tools, UDID, 10)
        self.assertEqual(self.registry.read_bytes(), before)
        self.assertEqual(call.call_args.args, (self.tools, "bootstatus", UDID, "-b"))

    def test_shutdown_does_not_touch_already_stopped_device(self):
        self.register()
        with patch.object(qa, "inventory", return_value=inventory(state="Shutdown")), patch.object(qa, "simctl") as call:
            self.assertTrue(qa.shutdown(self.tools, UDID)["shutdownRequested"])
            call.assert_not_called()

    def test_open_url_rejects_credentials_file_scheme_and_control_chars(self):
        for value in ["file:///private/data", "https://user:secret@example.test", "https://example.test/\nfoo", "javascript:alert(1)"]:
            with self.subTest(value=value), self.assertRaises(qa.QAError):
                qa.open_url(self.tools, UDID, value)

    def test_url_query_is_single_argument_and_success_output_omits_it(self):
        self.register()
        url = "https://example.test/path?token=fixture-private&x=$(echo nope)"
        with patch.object(qa, "inventory", return_value=inventory()), patch.object(qa, "simctl") as call:
            result = qa.open_url(self.tools, UDID, url)
        self.assertEqual(call.call_args.args, (self.tools, "openurl", UDID, url))
        self.assertNotIn("fixture-private", json.dumps(result))

    def test_failure_stderr_is_private_not_echoed_to_cli(self):
        self.register()
        private = "https://example.test/?token=fixture-private"
        failure = subprocess.CompletedProcess([], 1, "private-account@example.test", private)
        with patch.object(qa, "xcode_tools", return_value=self.tools), patch.object(qa, "inventory", return_value=inventory()), patch.object(subprocess, "run", return_value=failure), contextlib.redirect_stderr(io.StringIO()) as stderr, contextlib.redirect_stdout(io.StringIO()) as stdout:
            code = qa.main(["open-url", "--udid", UDID, private])
        self.assertEqual(code, 1)
        self.assertNotIn("fixture-private", stderr.getvalue() + stdout.getvalue())
        self.assertNotIn("private-account", stderr.getvalue() + stdout.getvalue())
        diagnostic = next(self.root.glob("*-ios-diagnostic-*/diagnostic.log"))
        self.assertIn("fixture-private", diagnostic.read_text())
        self.assertEqual(diagnostic.stat().st_mode & 0o777, 0o600)

    def test_subprocess_timeout_never_prints_exception_argv(self):
        with patch.object(subprocess, "run", side_effect=subprocess.TimeoutExpired(["simctl", "token=fixture-private"], 10)):
            with self.assertRaises(qa.QAError) as error:
                qa.run(["simctl", "token=fixture-private"], env={}, timeout=10)
        self.assertNotIn("fixture-private", str(error.exception))

    def make_app(self, simulator=True):
        app = self.root / "Game.app"
        app.mkdir()
        with (app / "Info.plist").open("wb") as handle:
            plistlib.dump({"CFBundleIdentifier": "com.example.game", "CFBundleSupportedPlatforms": ["iPhoneSimulator" if simulator else "iPhoneOS"], "DTPlatformName": "iphonesimulator" if simulator else "iphoneos"}, handle)
        return app

    def test_install_accepts_simulator_build_and_explicit_udid(self):
        app = self.make_app()
        self.register()
        with patch.object(qa, "inventory", return_value=inventory()), patch.object(qa, "simctl") as call:
            result = qa.install_app(self.tools, UDID, app)
        self.assertTrue(result["installCompleted"])
        call.assert_called_once_with(self.tools, "install", UDID, app.resolve(), timeout=120)

    def test_install_refuses_ipa_and_physical_iphone_app(self):
        ipa = self.root / "TapTap.ipa"
        ipa.write_bytes(b"fixture")
        with self.assertRaisesRegex(qa.QAError, "IPA"):
            qa.simulator_app(ipa)
        app = self.make_app(simulator=False)
        with self.assertRaisesRegex(qa.QAError, "iPhoneSimulator"):
            qa.simulator_app(app)

    def test_launch_rejects_shell_fragments_before_device_operation(self):
        with patch.object(qa, "inventory") as get:
            for bundle in ["--help", "com.foo;echo x", "com.foo/../bar", "com.foo\nbar"]:
                with self.subTest(bundle=bundle), self.assertRaises(qa.QAError):
                    qa.launch_app(self.tools, UDID, bundle)
            get.assert_not_called()

    def test_capture_requires_valid_png_and_never_reads_app_data(self):
        self.register()
        def command(tools, *args, **kwargs):
            Path(args[-1]).write_bytes(b"\x89PNG\r\n\x1a\nfixture")
        with patch.object(qa, "inventory", return_value=inventory()), patch.object(qa, "simctl", side_effect=command) as call:
            result = qa.capture(self.tools, UDID)
        self.assertEqual(result["evidenceType"], "IOS_SIMULATOR")
        self.assertEqual(result["releaseGate"], "NOT_EVALUATED")
        self.assertEqual(call.call_args.args[:5], (self.tools, "io", UDID, "screenshot", "--type=png"))
        self.assertEqual(call.call_count, 1)

    def test_capture_missing_png_is_not_success(self):
        self.register()
        with patch.object(qa, "inventory", return_value=inventory()), patch.object(qa, "simctl"):
            with self.assertRaisesRegex(qa.QAError, "有效"):
                qa.capture(self.tools, UDID)


if __name__ == "__main__":
    unittest.main()
