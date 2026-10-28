"""Safety and failure-path tests; no SDK/device/network dependency."""
import importlib.util
from contextlib import redirect_stderr, redirect_stdout
import io
import json
import os
from pathlib import Path
import subprocess
import stat
import tempfile
import unittest
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location("android_device", Path(__file__).with_name("android-device.py"))
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class AndroidQATests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        self.env = patch.dict(os.environ, {"ANDROID_AVD_HOME": str(self.home / "avd")})
        self.env.start()
        self.tools = {"adb": Path("/sdk/platform-tools/adb"), "emulator": Path("/sdk/emulator/emulator"),
                      "avdmanager": Path("/sdk/cmdline-tools/latest/bin/avdmanager"), "sdk": Path("/sdk")}

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def managed(self, name="creator-qa-compact-phone"):
        root = qa.avd_home()
        directory = root / f"{name}.avd"
        directory.mkdir(parents=True)
        (root / f"{name}.ini").write_text(f"path={directory}\n")
        (directory / "config.ini").write_text(f"{qa.MARKER}=1\nAvdId={name}\n")
        return name, directory

    def test_profiles_have_real_dp_pixel_relationship(self):
        image, profiles = qa.load_profiles()
        self.assertEqual(image, "system-images;android-35;google_apis;arm64-v8a")
        self.assertEqual(set(profiles), {"compact-phone", "tall-phone", "tablet"})
        self.assertEqual(profiles["tall-phone"]["heightDp"], 844)

    def test_malformed_density_and_duplicate_profiles_rejected(self):
        source = json.loads(qa.PROFILE_FILE.read_text())
        source["profiles"][0]["densityDpi"] = 1
        path = self.home / "profiles.json"
        path.write_text(json.dumps(source))
        with self.assertRaises(qa.QAError):
            qa.load_profiles(path)
        source = json.loads(qa.PROFILE_FILE.read_text())
        source["profiles"].append(source["profiles"][0])
        path.write_text(json.dumps(source))
        with self.assertRaises(qa.QAError):
            qa.load_profiles(path)

    def test_avd_traversal_and_non_managed_names_rejected(self):
        for name in ("Pixel_8", "creator-qa-../../user", "creator-qa-x;reboot", "../creator-qa-x"):
            with self.subTest(name=name), self.assertRaises(qa.QAError):
                qa.managed_avd(name)

    def test_prefix_alone_cannot_claim_existing_avd(self):
        name, directory = self.managed()
        (directory / "config.ini").write_text(f"AvdId={name}\n")
        with self.assertRaisesRegex(qa.QAError, "管理标记"):
            qa.managed_avd(name)

    def test_descriptor_cannot_redirect_to_user_directory(self):
        name, _ = self.managed()
        (qa.avd_home() / f"{name}.ini").write_text(f"path={self.home / 'personal'}\n")
        with self.assertRaisesRegex(qa.QAError, "专属管理目录"):
            qa.managed_avd(name)

    def test_symlink_cannot_claim_existing_avd(self):
        name, directory = self.managed()
        descriptor = qa.avd_home() / f"{name}.ini"
        saved = self.home / "saved.ini"
        descriptor.rename(saved)
        descriptor.symlink_to(saved)
        with self.assertRaisesRegex(qa.QAError, "符号链接"):
            qa.managed_avd(name)

    def test_physical_and_remote_serials_rejected_before_any_adb(self):
        with patch.object(qa, "run") as run:
            for serial in ("R58M0123", "192.168.0.1:5555", "emulator-5555", "emulator-22", "emulator-5554;rm"):
                with self.subTest(serial=serial), self.assertRaises(qa.QAError):
                    qa.adb(self.tools, serial, "emu", "kill")
            run.assert_not_called()

    def test_every_targeted_adb_argv_has_explicit_serial_and_no_host_shell(self):
        with patch.object(subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
            qa.adb(self.tools, "emulator-5554", "get-state")
            args, kwargs = run.call_args
            self.assertEqual(args[0], ["/sdk/platform-tools/adb", "-H", "127.0.0.1", "-P", "5037", "-s", "emulator-5554", "get-state"])
            self.assertIs(kwargs["shell"], False)

    def test_not_started_fails_without_selecting_another_device(self):
        with patch.object(qa, "run", return_value=subprocess.CompletedProcess([], 1, "", "not found")) as run:
            with self.assertRaisesRegex(qa.QAError, "未启动"):
                qa.connected_managed(self.tools, "emulator-5554")
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][5:7], ["-s", "emulator-5554"])

    def test_running_unmanaged_avd_rejected(self):
        results = [subprocess.CompletedProcess([], 0, "device\n", ""),
                   subprocess.CompletedProcess([], 0, "Personal_Phone\nOK\n", "")]
        with patch.object(qa, "run", side_effect=results), self.assertRaises(qa.QAError):
            qa.connected_managed(self.tools, "emulator-5554")

    def test_running_avd_identity_must_match_expected(self):
        name, _ = self.managed()
        results = [subprocess.CompletedProcess([], 0, "device\n", ""),
                   subprocess.CompletedProcess([], 0, f"{name}\nOK\n", "")]
        with patch.object(qa, "run", side_effect=results), self.assertRaisesRegex(qa.QAError, "其他 AVD"):
            qa.connected_managed(self.tools, "emulator-5554", expected="creator-qa-tablet")

    def test_url_remote_shell_metacharacters_are_quoted(self):
        url = "https://example.test/game?q=a&x=$(id);echo+bad"
        with patch.object(qa, "connected_managed", return_value="creator-qa-compact-phone"), patch.object(qa, "run") as run:
            qa.open_url(self.tools, "emulator-5554", url)
            args = run.call_args.args[0]
            self.assertEqual(args[-1], "'" + url + "'")
            self.assertEqual(args[5:8], ["-s", "emulator-5554", "shell"])

    def test_url_accounts_file_scheme_and_control_characters_rejected(self):
        with patch.object(qa, "connected_managed") as connected:
            for url in ("https://user:secret@example.test", "file:///etc/passwd", "https://example.test/\ncmd"):
                with self.subTest(url=url), self.assertRaises(qa.QAError):
                    qa.open_url(self.tools, "emulator-5554", url)
            connected.assert_not_called()

    def test_launch_app_rejects_dangerous_package_before_any_device_operation(self):
        with patch.object(qa, "connected_managed") as connected, patch.object(qa, "adb_shell") as shell:
            for package in ("com.taptap;reboot", "com.taptap\ncmd", "com.taptap/Activity", "-pcom.taptap", "com..taptap", "com.123bad"):
                with self.subTest(package=package), self.assertRaisesRegex(qa.QAError, "包名无效"):
                    qa.launch_app(self.tools, "emulator-5554", package)
            connected.assert_not_called()
            shell.assert_not_called()

    def test_launch_app_missing_application_does_not_guess_activity(self):
        result = subprocess.CompletedProcess([], 0, "No activity found\n", "")
        with patch.object(qa, "connected_managed") as connected, patch.object(qa, "adb_shell", return_value=result) as shell:
            with self.assertRaisesRegex(qa.QAError, "应用未安装"):
                qa.launch_app(self.tools, "emulator-5554", "com.missing.app")
        connected.assert_called_once_with(self.tools, "emulator-5554")
        self.assertEqual(shell.call_count, 1)

    def test_launch_app_refuses_component_owned_by_another_package(self):
        result = subprocess.CompletedProcess([], 0, "com.other/.MainActivity\n", "")
        with patch.object(qa, "connected_managed"), patch.object(qa, "adb_shell", return_value=result) as shell:
            with self.assertRaisesRegex(qa.QAError, "不属于指定应用"):
                qa.launch_app(self.tools, "emulator-5554", "com.taptap")
        self.assertEqual(shell.call_count, 1)

    def test_launch_app_rejects_ambiguous_components(self):
        result = subprocess.CompletedProcess([], 0, "com.taptap/.First\ncom.taptap/.Second\n", "")
        with patch.object(qa, "connected_managed"), patch.object(qa, "adb_shell", return_value=result) as shell:
            with self.assertRaisesRegex(qa.QAError, "入口不明确"):
                qa.launch_app(self.tools, "emulator-5554", "com.taptap")
        self.assertEqual(shell.call_count, 1)

    def test_launch_app_uses_resolved_launcher_component_and_explicit_serial(self):
        component = "com.taptap/.ui.RealLauncher$Alias"
        results = [subprocess.CompletedProcess([], 0, f"priority=0 preferredOrder=0 match=0x108000\n{component}\n", ""),
                   subprocess.CompletedProcess([], 0, "Status: ok\n", "")]
        with patch.object(qa, "connected_managed") as connected, patch.object(qa, "adb_shell", side_effect=results) as shell:
            result = qa.launch_app(self.tools, "emulator-5554", "com.taptap")
        connected.assert_called_once_with(self.tools, "emulator-5554")
        self.assertEqual(shell.call_args_list[0].args, (self.tools, "emulator-5554", "cmd", "package", "resolve-activity", "--brief",
                                                     "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-p", "com.taptap"))
        self.assertEqual(shell.call_args_list[1].args, (self.tools, "emulator-5554", "am", "start", "-W", "-n", component))
        self.assertEqual(result["component"], component)
        self.assertTrue(result["launchRequested"])
        parsed = qa.parser().parse_args(["launch-app", "--serial", "emulator-5554", "--package", "com.taptap"])
        self.assertEqual(parsed.package, "com.taptap")

    def test_install_requires_explicit_local_apk(self):
        with patch.object(qa, "connected_managed") as connected:
            for path in ("https://example.test/a.apk", str(self.home / "missing.apk")):
                with self.assertRaises(qa.QAError):
                    qa.install_apk(self.tools, "emulator-5554", path)
            connected.assert_not_called()
        apk = self.home / "game with spaces.apk"
        apk.write_bytes(b"local apk fixture")
        with patch.object(qa, "connected_managed"), patch.object(qa, "run") as run:
            qa.install_apk(self.tools, "emulator-5554", str(apk))
            self.assertEqual(run.call_args.args[0][-3:], ["install", "-r", str(apk.resolve())])

    def test_remote_adb_environment_cannot_redirect_actions(self):
        with patch.dict(os.environ, {"ADB_SERVER_SOCKET": "tcp:remote:5037", "ANDROID_ADB_SERVER_ADDRESS": "remote"}), patch.object(qa, "run") as run:
            qa.adb(self.tools, "emulator-5554", "get-state")
            self.assertNotIn("ADB_SERVER_SOCKET", run.call_args.kwargs["env"])
            self.assertNotIn("ANDROID_ADB_SERVER_ADDRESS", run.call_args.kwargs["env"])
            self.assertEqual(run.call_args.args[0][1:5], ["-H", "127.0.0.1", "-P", "5037"])

    def test_sdk_discovery_accepts_explicit_root_without_path_install(self):
        sdk = self.home / "sdk"
        for relative in ("platform-tools/adb", "emulator/emulator", "cmdline-tools/latest/bin/avdmanager"):
            file = sdk / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("fixture")
            file.chmod(0o755)
        with patch.dict(os.environ, {"ANDROID_HOME": str(sdk)}), patch.object(qa.shutil, "which", return_value=None):
            tools = qa.sdk_tools()
            self.assertEqual(tools["sdk"], sdk.resolve())
            self.assertEqual(tools["adb"], sdk.resolve() / "platform-tools/adb")

    def test_jdk21_is_preferred_without_java_home(self):
        with patch.dict(os.environ, {"JAVA_HOME": ""}), patch.object(Path, "is_file", return_value=True):
            env = qa.android_env(self.tools)
        self.assertEqual(env["JAVA_HOME"], "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home")

    def test_java_probe_returns_only_version_without_launcher_secrets(self):
        result = subprocess.CompletedProcess([], 0, "private-launcher-token", 'openjdk version "21.0.9"\nproxy=https://user:password@example.test')
        with patch.object(qa, "android_env", return_value={"JAVA_HOME": "/runtime/jdk"}), \
                patch.object(Path, "is_file", return_value=True), patch.object(qa.os, "access", return_value=True), \
                patch.object(qa.subprocess, "run", return_value=result):
            java = qa.java_status(self.tools)
        self.assertTrue(java["usable"])
        self.assertEqual(java["version"], "21.0.9")
        self.assertNotIn("private-launcher", json.dumps(java))
        self.assertNotIn("password", json.dumps(java))

    def test_missing_java_prevents_ready_even_when_sdk_and_image_exist(self):
        stdout = io.StringIO()
        with patch.object(qa, "sdk_tools", return_value=self.tools), patch.object(Path, "exists", return_value=True), \
                patch.object(qa, "java_status", return_value={"executable": None, "usable": False, "version": None}), \
                redirect_stdout(stdout):
            code = qa.main(["doctor"])
        self.assertEqual(code, 0)
        self.assertFalse(json.loads(stdout.getvalue())["ready"])

    def test_open_url_failure_writes_private_diagnostic_without_cli_query(self):
        private = "https://example.test/play?token=private-query&password=secret"
        stdout, stderr = io.StringIO(), io.StringIO()
        failure = subprocess.CompletedProcess([], 1, "", f"SDK proxy user:secret; unable to open {private}")
        with patch.object(qa, "OUTPUT", self.home / "output"), patch.object(qa, "sdk_tools", return_value=self.tools), \
                patch.object(qa, "connected_managed", return_value="creator-qa-compact-phone"), \
                patch.object(qa.subprocess, "run", return_value=failure), redirect_stdout(stdout), redirect_stderr(stderr):
            code = qa.main(["open-url", "--serial", "emulator-5554", private])
        self.assertEqual(code, 1)
        self.assertNotIn("private-query", stderr.getvalue() + stdout.getvalue())
        self.assertNotIn("secret", stderr.getvalue() + stdout.getvalue())
        diagnostic = next((self.home / "output").glob("*/diagnostic.log"))
        self.assertIn("private-query", diagnostic.read_text())
        self.assertEqual(stat.S_IMODE(diagnostic.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(diagnostic.parent.stat().st_mode), 0o700)
        self.assertIn(str(diagnostic), stderr.getvalue())

    def test_capture_screencap_and_logcat_failures_never_print_credentials(self):
        for fail_command in ("screencap", "logcat"):
            with self.subTest(fail_command=fail_command):
                def fake_run(argv, **kwargs):
                    binary = not kwargs["text"]
                    if fail_command in argv:
                        secret = "https://example.test/?token=private-query user:secret"
                        return subprocess.CompletedProcess(argv, 1, b"" if binary else "", secret.encode() if binary else secret)
                    if "screencap" in argv:
                        return subprocess.CompletedProcess(argv, 0, b"png fixture", b"")
                    if "cat" in argv:
                        return subprocess.CompletedProcess(argv, 0, "<hierarchy/>", "")
                    return subprocess.CompletedProcess(argv, 0, "", "")
                stdout, stderr = io.StringIO(), io.StringIO()
                output = self.home / fail_command
                with patch.object(qa, "OUTPUT", output), patch.object(qa, "sdk_tools", return_value=self.tools), \
                        patch.object(qa, "connected_managed", return_value="creator-qa-compact-phone"), \
                        patch.object(qa.subprocess, "run", side_effect=fake_run), redirect_stdout(stdout), redirect_stderr(stderr):
                    code = qa.main(["capture", "--serial", "emulator-5554"])
                self.assertEqual(code, 1)
                self.assertNotIn("private-query", stdout.getvalue() + stderr.getvalue())
                self.assertNotIn("secret", stdout.getvalue() + stderr.getvalue())
                diagnostic = next(output.glob("*/diagnostic.log"))
                self.assertIn("private-query", diagnostic.read_text())

    def test_existing_avd_is_never_overwritten(self):
        _, directory = self.managed()
        before = (directory / "config.ini").read_bytes()
        with patch.object(qa, "run") as run, self.assertRaisesRegex(qa.QAError, "不覆盖"):
            qa.create(self.tools, "compact-phone")
        self.assertEqual((directory / "config.ini").read_bytes(), before)
        run.assert_not_called()

    def test_missing_sdk_fails_without_spawning(self):
        with patch.object(qa, "run") as run, self.assertRaisesRegex(qa.QAError, "未找到 Android SDK"):
            qa.create({}, "compact-phone")
        run.assert_not_called()

    def test_create_writes_dimensions_only_to_dedicated_avd(self):
        def fake_create(args, **kwargs):
            directory = Path(args[-1])
            directory.mkdir()
            (directory / "config.ini").write_text("hw.lcd.width=1\n")
            (qa.avd_home() / "creator-qa-tall-phone.ini").write_text(f"path={directory}\n")
            return subprocess.CompletedProcess(args, 0, "", "")
        with patch.object(qa, "run", side_effect=fake_create) as run:
            result = qa.create(self.tools, "tall-phone")
            self.assertNotIn("--force", run.call_args.args[0])
            directory, config = qa.managed_avd(result["avd"])
            self.assertEqual(config["hw.lcd.width"], "780")
            self.assertEqual(config["hw.lcd.height"], "1688")
            self.assertEqual(config["skin.path"], "_no_skin")
            self.assertEqual(config["skin.dynamic"], "yes")
            self.assertEqual(config[qa.MARKER], "1")
            self.assertEqual(directory.parent, qa.avd_home())

    def test_capture_bounds_prevent_unbounded_log_collection(self):
        with patch.object(qa, "connected_managed") as connected:
            for lines in (0, -1, 1001):
                with self.assertRaises(qa.QAError):
                    qa.capture(self.tools, "emulator-5554", lines)
            connected.assert_not_called()

    def test_capture_does_not_expose_ui_or_log_contents_in_cli_result(self):
        def fake_adb(tools, serial, *args, **kwargs):
            value = b"png fixture" if kwargs.get("binary") else "private-account@example.test"
            return subprocess.CompletedProcess([], 0, value, "")
        def fake_shell(tools, serial, *args, **kwargs):
            if args[0] == "uiautomator":
                raise qa.QAError("private-account@example.test")
            return subprocess.CompletedProcess([], 0, "", "")
        with patch.object(qa, "OUTPUT", self.home / "capture"), \
                patch.object(qa, "connected_managed", return_value="creator-qa-compact-phone"), \
                patch.object(qa, "adb", side_effect=fake_adb), patch.object(qa, "adb_shell", side_effect=fake_shell):
            result = qa.capture(self.tools, "emulator-5554", 100)
        self.assertNotIn("private-account", json.dumps(result))
        directory = Path(result["output"])
        self.assertIn("private-account", (directory / "errors.log").read_text())
        self.assertIn("private-account", (directory / "capture-errors.log").read_text())

    def test_boot_timeout_terminates_only_session_spawned_by_start(self):
        name, _ = self.managed()
        process = Mock(pid=1234)
        process.poll.return_value = None
        process.wait.return_value = 0
        with patch.object(qa, "OUTPUT", self.home / "output"), patch.object(qa, "free_port", return_value=5554), \
                patch.object(qa.subprocess, "Popen", return_value=process) as popen, \
                patch.object(qa, "connected_managed", side_effect=qa.QAError("not ready")), \
                patch.object(qa.time, "monotonic", side_effect=[0, 1, 11]), patch.object(qa.time, "sleep"), \
                patch.object(qa.os, "killpg") as killpg, \
                self.assertRaisesRegex(qa.QAError, "启动在 10 秒内未完成"):
            qa.start(self.tools, name, 10)
        self.assertEqual(killpg.call_args_list[0].args, (1234, qa.signal.SIGTERM))
        self.assertEqual(killpg.call_args_list[1].args, (1234, qa.signal.SIGKILL))
        process.terminate.assert_not_called()
        process.kill.assert_not_called()
        args = popen.call_args.args[0]
        self.assertIn("-no-window", args)
        self.assertIn("-no-snapshot", args)
        self.assertNotIn("-wipe-data", args)
        self.assertIs(popen.call_args.kwargs["shell"], False)

    def test_boot_success_waits_for_matching_avd_and_boot_property(self):
        name, _ = self.managed()
        process = Mock(pid=1234)
        process.poll.return_value = None
        with patch.object(qa, "OUTPUT", self.home / "output"), patch.object(qa, "free_port", return_value=5554), \
                patch.object(qa.subprocess, "Popen", return_value=process), \
                patch.object(qa, "connected_managed", return_value=name) as connected, \
                patch.object(qa, "adb_shell", return_value=subprocess.CompletedProcess([], 0, "1\n", "")):
            result = qa.start(self.tools, name, 10)
        self.assertTrue(result["bootCompleted"])
        connected.assert_called_once_with(self.tools, "emulator-5554", expected=name)
        process.terminate.assert_not_called()


if __name__ == "__main__":
    unittest.main()
