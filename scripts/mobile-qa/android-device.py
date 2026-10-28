#!/usr/bin/env python3
"""Manage dedicated generic Android QA emulators; never target physical devices.

Python 3.10+ / standard library only. Runtime evidence stays under output/mobile-qa.
Android shell arguments are individually POSIX quoted because adb's shell protocol
joins arguments remotely; Python never runs a host shell or accepts shell snippets.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit
import uuid


ROOT = Path(__file__).resolve().parents[2]
PROFILE_FILE = ROOT / "docs/mobile-device-profiles.json"
OUTPUT = ROOT / "output/mobile-qa"
PREFIX = "creator-qa-"
MARKER = "creator.qa.managed"
AVD_RE = re.compile(r"creator-qa-[a-z0-9]+(?:-[a-z0-9]+)*\Z")
SERIAL_RE = re.compile(r"emulator-(\d{4,5})\Z")
PACKAGE_PATTERN = r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+"
PACKAGE_RE = re.compile(PACKAGE_PATTERN + r"\Z")
COMPONENT_RE = re.compile(r"(" + PACKAGE_PATTERN + r")/(\.?[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\Z")


class QAError(Exception):
    pass


def run(argv, *, timeout=30, check=True, binary=False, input=None, env=None):
    try:
        result = subprocess.run([str(x) for x in argv], input=input,
                                capture_output=True, text=not binary,
                                timeout=timeout, env=env, shell=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        # TimeoutExpired includes the full argv, which can contain a test URL.
        raise QAError(f"命令失败或超时：{Path(str(argv[0])).name} ({type(exc).__name__})") from exc
    if check and result.returncode:
        error = result.stderr if not binary else result.stderr.decode(errors="replace")
        try:
            diagnostic = evidence_dir("diagnostic") / "diagnostic.log"
            # No argv/environment: stderr itself can contain URL queries or SDK
            # credentials. Keep it private and never include it in CLI errors.
            with diagnostic.open("w", encoding="utf-8") as handle:
                diagnostic.chmod(0o600)
                handle.write(error)
            detail = f"本地诊断：{diagnostic}"
        except OSError:
            detail = "无法写入本地诊断文件"
        raise QAError(f"{Path(str(argv[0])).name} 退出 {result.returncode}；{detail}")
    return result


def load_profiles(path=PROFILE_FILE):
    try:
        data = json.loads(Path(path).read_text())
        if data["schemaVersion"] != 1 or not re.fullmatch(
                r"system-images;android-\d+;google_apis;arm64-v8a", data["systemImage"]):
            raise ValueError("需明确 ARM64 Google APIs 系统镜像")
        profiles = {}
        for p in data["profiles"]:
            if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", p["id"]) or p["id"] in profiles:
                raise ValueError("配置 ID 无效或重复")
            for key in ("widthDp", "heightDp", "widthPx", "heightPx", "densityDpi", "ramMb"):
                if type(p[key]) is not int or p[key] <= 0:
                    raise ValueError(f"{key} 必须为正整数")
            if not (120 <= p["densityDpi"] <= 640 and 1024 <= p["ramMb"] <= 8192):
                raise ValueError("密度或内存超出支持范围")
            for axis in ("width", "height"):
                if abs(p[f"{axis}Px"] * 160 / p["densityDpi"] - p[f"{axis}Dp"]) > 1:
                    raise ValueError("像素、逻辑尺寸、密度不一致")
            profiles[p["id"]] = p
        if not profiles:
            raise ValueError("没有屏幕配置")
        return data["systemImage"], profiles
    except (OSError, KeyError, TypeError, ValueError) as exc:
        raise QAError(f"设备配置无效：{exc}") from exc


def sdk_tools():
    """Discover SDKs without user-specific paths or mandatory shell configuration."""
    candidates = []
    for key in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(key):
            candidates.append(Path(os.environ[key]).expanduser())
    candidates += [Path.home() / "Library/Android/sdk", Path.home() / "Android/Sdk",
                   Path("/opt/homebrew/share/android-commandlinetools"),
                   Path("/usr/local/share/android-commandlinetools")]
    for name in ("adb", "emulator", "avdmanager", "sdkmanager"):
        found = shutil.which(name)
        if found:
            resolved = Path(found).resolve()
            for parent in resolved.parents:
                if parent.name in ("platform-tools", "emulator", "cmdline-tools"):
                    candidates.append(parent.parent)
    roots = list(dict.fromkeys(p.resolve() for p in candidates))
    tools = {}
    selected = None
    for name, rel in (("adb", "platform-tools/adb"), ("emulator", "emulator/emulator"),
                      ("avdmanager", "cmdline-tools/latest/bin/avdmanager")):
        options = [root / rel for root in roots]
        if name == "avdmanager":
            options += [p for root in roots for p in sorted(root.glob("cmdline-tools/*/bin/avdmanager"), reverse=True)]
        if shutil.which(name):
            options.append(Path(shutil.which(name)).resolve())
        tools[name] = next((p for p in options if p.is_file() and os.access(p, os.X_OK)), None)
        if tools[name] and name == "emulator":
            selected = tools[name].parent.parent
    tools["sdk"] = selected or next((p for p in roots if p.is_dir()), None)
    return tools


def need(tools, *names):
    missing = [name for name in names if not tools.get(name)]
    if missing:
        raise QAError("未找到 Android SDK 工具：" + ", ".join(missing) + "；先运行 doctor，配置 ANDROID_HOME 或安装官方 SDK。")


def android_env(tools):
    env = os.environ.copy()
    # A caller's remote adb configuration must never redirect QA device actions.
    env.pop("ADB_SERVER_SOCKET", None)
    env.pop("ANDROID_ADB_SERVER_ADDRESS", None)
    env["ANDROID_ADB_SERVER_PORT"] = "5037"
    env["ANDROID_AVD_HOME"] = str(avd_home())
    if tools.get("sdk"):
        env["ANDROID_HOME"] = str(tools["sdk"])
        env["ANDROID_SDK_ROOT"] = str(tools["sdk"])
    if not env.get("JAVA_HOME"):
        homes = [Path("/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"),
                 Path("/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"),
                 Path("/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"),
                 Path("/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"),
                 Path("/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home")]
        home = next((p for p in homes if (p / "bin/java").is_file()), None)
        if home:
            env["JAVA_HOME"] = str(home)
    return env


def java_status(tools):
    """Probe the same Java selection used by avdmanager, without printing env."""
    env = android_env(tools)
    home = env.get("JAVA_HOME")
    executable = Path(home).expanduser() / "bin/java" if home else shutil.which("java")
    if not executable or not Path(executable).is_file() or not os.access(executable, os.X_OK):
        return {"executable": str(executable) if executable else None, "usable": False, "version": None}
    try:
        result = run([executable, "-version"], timeout=10, check=False, env=env)
        # Do not echo arbitrary launcher output. Extract only the Java version.
        match = re.search(r'(?:openjdk|java) version "([0-9][0-9A-Za-z._+\-]{0,49})"',
                          result.stderr + "\n" + result.stdout)
        version = match.group(1) if match else None
        return {"executable": str(executable), "usable": result.returncode == 0 and version is not None,
                "version": version}
    except QAError:
        return {"executable": str(executable), "usable": False, "version": None}


def avd_home():
    if os.environ.get("ANDROID_AVD_HOME"):
        return Path(os.environ["ANDROID_AVD_HOME"]).expanduser().resolve()
    if os.environ.get("ANDROID_USER_HOME"):
        return (Path(os.environ["ANDROID_USER_HOME"]).expanduser() / "avd").resolve()
    return Path.home() / ".android/avd"


def read_ini(path):
    result = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip()
    return result


def managed_avd(name):
    if not AVD_RE.fullmatch(name):
        raise QAError("拒绝非托管 AVD：必须使用 creator-qa- 前缀和安全名称。")
    home = avd_home().resolve()
    directory = home / f"{name}.avd"
    descriptor = home / f"{name}.ini"
    if directory.is_symlink() or descriptor.is_symlink():
        raise QAError("拒绝符号链接 AVD。")
    try:
        if Path(read_ini(descriptor)["path"]).resolve() != directory.resolve():
            raise QAError("AVD 路径不属于专属管理目录。")
        config = read_ini(directory / "config.ini")
    except (OSError, KeyError) as exc:
        raise QAError(f"托管 AVD 不存在或配置不完整：{name}；先运行 create。") from exc
    if config.get(MARKER) != "1" or config.get("AvdId") != name:
        raise QAError("缺少专属管理标记，拒绝操作现有 AVD。")
    return directory, config


def validate_serial(serial):
    match = SERIAL_RE.fullmatch(serial)
    if not match or not (5554 <= int(match[1]) <= 5682) or int(match[1]) % 2:
        raise QAError("拒绝该 serial：只接受 emulator-5554 至 emulator-5682 的偶数端口。")
    return serial


def adb(tools, serial, *args, **kwargs):
    validate_serial(serial)
    need(tools, "adb")
    return run([tools["adb"], "-H", "127.0.0.1", "-P", "5037", "-s", serial, *args],
               env=android_env(tools), **kwargs)


def adb_shell(tools, serial, *args, **kwargs):
    return adb(tools, serial, "shell", *(shlex.quote(str(arg)) for arg in args), **kwargs)


def connected_managed(tools, serial, expected=None):
    validate_serial(serial)
    state = adb(tools, serial, "get-state", check=False, timeout=10)
    if state.returncode or state.stdout.strip() != "device":
        raise QAError(f"{serial} 未启动或未就绪；不会自动连接或操作其他设备。")
    response = adb(tools, serial, "emu", "avd", "name", timeout=10).stdout
    lines = [line.strip() for line in response.splitlines() if line.strip() and line.strip() != "OK"]
    if len(lines) != 1:
        raise QAError("无法确认 AVD 名称，拒绝操作。")
    name = lines[0]
    managed_avd(name)
    if expected is not None and name != expected:
        raise QAError(f"{serial} 属于其他 AVD，拒绝操作。")
    return name


def create(tools, profile_id):
    image, profiles = load_profiles()
    if profile_id not in profiles:
        raise QAError(f"未知 profile：{profile_id}")
    need(tools, "avdmanager")
    name = PREFIX + profile_id
    home = avd_home()
    directory = home / f"{name}.avd"
    if directory.exists() or (home / f"{name}.ini").exists():
        raise QAError(f"AVD 已存在，保留原配置且不覆盖：{name}")
    p = profiles[profile_id]
    home.mkdir(parents=True, exist_ok=True)
    run([tools["avdmanager"], "create", "avd", "--name", name, "--package", image,
         "--path", directory], input="no\n", env=android_env(tools), timeout=120)
    config_path = directory / "config.ini"
    values = read_ini(config_path)
    values.update({MARKER: "1", "creator.qa.profile": profile_id, "AvdId": name,
                   "avd.ini.displayname": name, "hw.lcd.width": str(p["widthPx"]),
                   "hw.lcd.height": str(p["heightPx"]), "hw.lcd.density": str(p["densityDpi"]),
                   "hw.ramSize": str(p["ramMb"]), "hw.keyboard": "yes",
                   "hw.mainKeys": "no", "hw.gpu.enabled": "yes", "hw.gpu.mode": "auto",
                   "skin.name": f'{p["widthPx"]}x{p["heightPx"]}', "skin.path": "_no_skin",
                   "skin.dynamic": "yes", "showDeviceFrame": "no"})
    config_path.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
    return {"avd": name, "profile": p, "systemImage": image}


def free_port(tools):
    for port in range(5554, 5683, 2):
        sockets = []
        try:
            for candidate in (port, port + 1):
                sock = socket.socket()
                sockets.append(sock)
                sock.bind(("127.0.0.1", candidate))
            state = adb(tools, f"emulator-{port}", "get-state", timeout=5, check=False)
            if state.returncode:
                return port
        except OSError:
            pass
        finally:
            for sock in sockets:
                sock.close()
    raise QAError("没有可用的本机 emulator 端口。")


def evidence_dir(kind):
    path = OUTPUT / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-{kind}-{uuid.uuid4().hex[:8]}")
    path.mkdir(parents=True, mode=0o700)
    return path


def terminate_launch(process):
    """Terminate only the new session created by our own Popen, including QEMU.

    The launcher can exit before its QEMU child; targeting its dedicated process
    group avoids leaving that child behind. Never discover/kill unrelated PIDs.
    """
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    elif process.poll() is None:
        process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        if os.name != "posix":
            process.kill()
    finally:
        if os.name == "posix":
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    process.wait(timeout=5)


def start(tools, name, timeout, window=False):
    need(tools, "adb", "emulator")
    managed_avd(name)
    if not 10 <= timeout <= 600:
        raise QAError("启动超时必须在 10 至 600 秒内。")
    port = free_port(tools)
    serial = f"emulator-{port}"
    output = evidence_dir("boot")
    args = [str(tools["emulator"]), "-avd", name, "-port", str(port), "-no-audio",
            "-no-boot-anim", "-no-snapshot", "-gpu", "swiftshader"]
    if not window:
        args.append("-no-window")
    # Android Emulator console/ADB ports bind loopback by default. Do not enable
    # gRPC, remote forwarding, adb tcpip, or any host-wide adb lifecycle action.
    with (output / "emulator.log").open("wb") as log:
        process = subprocess.Popen(args, stdout=log, stderr=subprocess.STDOUT,
                                   env=android_env(tools), shell=False, start_new_session=True)
    try:
        (output / "launch.json").write_text(json.dumps({"avd": name, "serial": serial, "pid": process.pid}, indent=2))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise QAError(f"模拟器提前退出；日志：{output}")
            try:
                connected_managed(tools, serial, expected=name)
                boot = adb_shell(tools, serial, "getprop", "sys.boot_completed", timeout=10)
                if boot.stdout.strip() == "1":
                    return {"avd": name, "serial": serial, "bootCompleted": True, "output": str(output)}
            except QAError:
                pass
            time.sleep(1)
        raise QAError(f"启动在 {timeout} 秒内未完成，已停止本次启动进程；日志：{output}")
    except BaseException:
        terminate_launch(process)
        raise


def status(tools, serial):
    name = connected_managed(tools, serial)
    return {"avd": name, "serial": serial,
            "bootCompleted": adb_shell(tools, serial, "getprop", "sys.boot_completed").stdout.strip() == "1",
            "screen": adb_shell(tools, serial, "wm", "size").stdout.strip(),
            "density": adb_shell(tools, serial, "wm", "density").stdout.strip()}


def open_url(tools, serial, url):
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or any(ord(c) < 32 for c in url):
        raise QAError("只允许无账号信息的 http/https URL。")
    connected_managed(tools, serial)
    adb_shell(tools, serial, "am", "start", "-a", "android.intent.action.VIEW", "-d", url)
    return {"serial": serial, "opened": parts.hostname}


def launch_app(tools, serial, package):
    if not PACKAGE_RE.fullmatch(package):
        raise QAError("包名无效：应为正常 Android 应用 ID，例如 com.taptap。")
    connected_managed(tools, serial)
    resolved = adb_shell(tools, serial, "cmd", "package", "resolve-activity", "--brief",
                         "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER",
                         "-p", package)
    # --brief may also print priority/match metadata. Accept only an exact
    # Android component, and never infer a class name from the package name.
    components = [line.strip() for line in resolved.stdout.splitlines()
                  if COMPONENT_RE.fullmatch(line.strip())]
    if len(components) != 1:
        raise QAError("应用未安装、没有 Launcher 入口，或入口不明确；未启动应用。")
    component = components[0]
    if COMPONENT_RE.fullmatch(component).group(1) != package:
        raise QAError("解析出的 Launcher 不属于指定应用，拒绝启动。")
    adb_shell(tools, serial, "am", "start", "-W", "-n", component)
    return {"serial": serial, "package": package, "component": component, "launchRequested": True}


def install_apk(tools, serial, apk):
    path = Path(apk).expanduser().resolve()
    if not path.is_file() or path.suffix.lower() != ".apk":
        raise QAError("只接受显式传入且存在的本地 .apk 文件，不自动下载。")
    connected_managed(tools, serial)
    adb(tools, serial, "install", "-r", str(path), timeout=120)
    return {"serial": serial, "installed": path.name}


def capture(tools, serial, log_lines):
    if not 1 <= log_lines <= 1000:
        raise QAError("logcat 行数必须为 1 至 1000。")
    name = connected_managed(tools, serial)
    output = evidence_dir("capture")
    (output / "screen.png").write_bytes(adb(tools, serial, "exec-out", "screencap", "-p", binary=True).stdout)
    errors = []
    remote_xml = f"/data/local/tmp/creator-qa-{uuid.uuid4().hex}.xml"
    try:
        adb_shell(tools, serial, "uiautomator", "dump", remote_xml, timeout=30)
        xml = adb(tools, serial, "exec-out", "cat", remote_xml).stdout
        if "<hierarchy" not in xml:
            raise QAError("未获得有效 UI 层级（Canvas 内容仍需截图检查）")
        (output / "ui.xml").write_text(xml)
    except QAError as exc:
        (output / "capture-errors.log").write_text(str(exc))
        errors.append("UI 层级未获得，详情仅保存在专属运行证据目录。")
    finally:
        adb_shell(tools, serial, "rm", "-f", remote_xml, check=False)
    logs = adb(tools, serial, "logcat", "-d", "-t", str(log_lines), "AndroidRuntime:E", "chromium:E", "*:S").stdout
    (output / "errors.log").write_text(logs)
    result = {"avd": name, "serial": serial, "output": str(output), "errors": errors,
              "scope": "仅专属测试 AVD：截图、UI 层级、限定错误日志；不读取账号数据库、凭据、全量日志或 bugreport。画面、UI 文本和错误可能带账号痕迹，只作为忽略的本地运行证据，禁止打印或提交内容；登录仅使用已授权的专用测试账号，不提取日常个人账号凭据。"}
    (output / "capture.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return result


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor", help="只检测本机 SDK 和镜像，不安装或操作设备")
    commands.add_parser("profiles", help="显示通用屏幕配置，非 OEM 真机")
    commands.add_parser("create", help="创建专属 AVD，不覆盖").add_argument("profile")
    s = commands.add_parser("start", help="启动专属 AVD，默认无窗口，有限启动等待")
    s.add_argument("avd")
    s.add_argument("--timeout", type=int, default=180)
    s.add_argument("--window", action="store_true")
    for name in ("status", "stop", "open-url", "launch-app", "install-apk", "capture"):
        command = commands.add_parser(name, help="解析真实 Launcher 组件并启动已安装应用" if name == "launch-app" else None)
        command.add_argument("--serial", required=True, help="start 返回的 emulator-偶数端口；拒绝实体设备")
        if name == "open-url":
            command.add_argument("url")
        elif name == "launch-app":
            command.add_argument("--package", required=True, help="已安装 Android 应用 ID，例如 com.taptap；不猜测 Activity 类名")
        elif name == "install-apk":
            command.add_argument("apk")
        elif name == "capture":
            command.add_argument("--log-lines", type=int, default=200)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "profiles":
            image, profiles = load_profiles()
            result = {"systemImage": image, "profiles": list(profiles.values())}
        else:
            tools = sdk_tools()
            if args.command == "doctor":
                image, profiles = load_profiles()
                image_path = tools["sdk"] / Path(*image.split(";")) if tools["sdk"] else None
                java = java_status(tools)
                result = {"tools": {key: str(value) if value else None for key, value in tools.items()},
                          "java": java,
                          "systemImage": image, "imageInstalled": bool(image_path and (image_path / "package.xml").exists()),
                          "avdHome": str(avd_home()), "profiles": list(profiles),
                          "ready": all(tools.get(key) for key in ("adb", "emulator", "avdmanager")) and bool(image_path and (image_path / "package.xml").exists()) and java["usable"]}
            elif args.command == "create":
                result = create(tools, args.profile)
            elif args.command == "start":
                result = start(tools, args.avd, args.timeout, args.window)
            elif args.command == "status":
                result = status(tools, args.serial)
            elif args.command == "stop":
                name = connected_managed(tools, args.serial)
                adb(tools, args.serial, "emu", "kill")
                result = {"avd": name, "serial": args.serial, "stopRequested": True}
            elif args.command == "open-url":
                result = open_url(tools, args.serial, args.url)
            elif args.command == "launch-app":
                result = launch_app(tools, args.serial, args.package)
            elif args.command == "install-apk":
                result = install_apk(tools, args.serial, args.apk)
            else:
                result = capture(tools, args.serial, args.log_lines)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if args.command == "capture" and result["errors"] else 0
    except (QAError, OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
