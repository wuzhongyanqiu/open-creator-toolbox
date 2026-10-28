#!/usr/bin/env python3
"""Dedicated iOS Simulator QA, not a physical iPhone or TapTap App Store test.

Python 3.10+ / standard library. Requires full Xcode and an installed iOS runtime.
Never installs Xcode/runtimes, switches global xcode-select, erases devices, or
reads application data. All mutable operations target an explicit managed UDID.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import subprocess
import sys
import uuid
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output/mobile-qa"
REGISTRY = OUTPUT / "ios-managed/registry.json"
PREFIX = "creator-qa-ios-"
UDID_RE = re.compile(r"[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}\Z")
BUNDLE_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+\Z")
PROFILE_FAMILIES = {"compact-phone": "iPhone", "large-phone": "iPhone", "tablet": "iPad"}
INSTALL_URL = "https://developer.apple.com/xcode/"


class QAError(Exception):
    pass


def evidence_dir(kind):
    directory = OUTPUT / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") +
                          f"-ios-{kind}-{uuid.uuid4().hex[:8]}")
    directory.mkdir(parents=True, mode=0o700)
    return directory


def private_text(path, text):
    with Path(path).open("w", encoding="utf-8") as handle:
        Path(path).chmod(0o600)
        handle.write(text)


def run(argv, *, env, timeout=30, check=True):
    try:
        result = subprocess.run([str(x) for x in argv], capture_output=True,
                                text=True, timeout=timeout, env=env, shell=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        # No argv or exception text: test URLs may contain private query values.
        raise QAError(f"命令失败或超时：{Path(str(argv[0])).name} ({type(exc).__name__})") from exc
    if check and result.returncode:
        try:
            diagnostic = evidence_dir("diagnostic") / "diagnostic.log"
            private_text(diagnostic, result.stderr + "\n" + result.stdout)
            detail = f"本地诊断：{diagnostic}"
        except OSError:
            detail = "无法写入本地诊断文件"
        raise QAError(f"{Path(str(argv[0])).name} 退出 {result.returncode}；{detail}")
    return result


def xcode_tools():
    """Select full Xcode only for child commands; never change xcode-select."""
    result = {"developerDir": None, "simctl": None, "env": os.environ.copy(),
              "reason": None, "installUrl": INSTALL_URL}
    if platform.system() != "Darwin":
        result["reason"] = "iOS Simulator 需要 macOS 与完整 Xcode。"
        return result
    configured = os.environ.get("DEVELOPER_DIR")
    candidates = [Path(configured).expanduser()] if configured else []
    candidates += [Path("/Applications/Xcode.app/Contents/Developer"),
                   Path.home() / "Applications/Xcode.app/Contents/Developer"]
    if not configured:
        try:
            selected = run(["/usr/bin/xcode-select", "-p"], env=result["env"],
                           check=False, timeout=10)
            if selected.returncode == 0:
                candidates.append(Path(selected.stdout.strip()))
        except QAError:
            pass
    for candidate in dict.fromkeys(candidates):
        # A Developer directory can also be explicitly supplied as Xcode.app.
        if candidate.suffix == ".app":
            candidate = candidate / "Contents/Developer"
        if not (candidate / "Applications/Simulator.app").is_dir():
            continue
        env = result["env"].copy()
        env["DEVELOPER_DIR"] = str(candidate.resolve())
        try:
            found = run(["/usr/bin/xcrun", "--find", "simctl"], env=env,
                        check=False, timeout=15)
        except QAError:
            continue
        path = Path(found.stdout.strip()) if found.returncode == 0 else None
        if path and path.is_file() and os.access(path, os.X_OK):
            result.update(developerDir=str(candidate.resolve()), simctl=str(path), env=env)
            return result
    result["reason"] = "未找到完整 Xcode / simctl；Command Line Tools 不包含 iOS Simulator。安装 Xcode 后在其设置中安装 iOS Simulator runtime。"
    return result


def need(tools):
    if not tools.get("simctl"):
        raise QAError(tools.get("reason") or "未找到 simctl，先运行 doctor。")


def simctl(tools, *args, **kwargs):
    need(tools)
    return run([tools["simctl"], *args], env=tools["env"], **kwargs)


def inventory(tools):
    response = simctl(tools, "list", "--json", timeout=30)
    try:
        data = json.loads(response.stdout)
        if not isinstance(data.get("devices"), dict) or not isinstance(data.get("runtimes"), list) or not isinstance(data.get("devicetypes"), list):
            raise ValueError()
        return data
    except (TypeError, ValueError):
        raise QAError("simctl 未返回完整的 JSON 设备/runtime/type 列表。") from None


def available_runtimes(data):
    return [r for r in data["runtimes"] if r.get("isAvailable") is True and
            r.get("identifier", "").startswith("com.apple.CoreSimulator.SimRuntime.iOS-")]


def family_types(data, family):
    return [t for t in data["devicetypes"] if t.get("name", "").startswith(family + " ") or
            t.get("name") == family or t.get("productFamily") == family]


def public_inventory(data):
    return {"runtimes": [{k: r.get(k) for k in ("identifier", "name", "version", "isAvailable")} for r in available_runtimes(data)],
            "deviceTypes": [{k: t.get(k) for k in ("identifier", "name", "productFamily")} for t in data["devicetypes"] if t in family_types(data, "iPhone") + family_types(data, "iPad")],
            "managedDevices": [{"runtime": runtime, "udid": d.get("udid"), "name": d.get("name"), "state": d.get("state"), "isAvailable": d.get("isAvailable")} for runtime, devices in data["devices"].items() for d in devices if d.get("name", "").startswith(PREFIX)]}


def doctor(tools):
    result = {"platform": platform.system(), "developerDir": tools.get("developerDir"),
              "simctl": tools.get("simctl"), "ready": False,
              "installUrl": INSTALL_URL, "reason": tools.get("reason"),
              "scope": "iOS Simulator / Safari / 自有 Simulator 构建；不代表物理 iPhone、App Store TapTap、真实广告或榜单已验收。"}
    if tools.get("simctl"):
        data = inventory(tools)
        result.update(public_inventory(data))
        result["ready"] = bool(result["runtimes"] and family_types(data, "iPhone"))
        if not result["runtimes"]:
            result["reason"] = "Xcode 可用，但未找到已安装且可用的 iOS runtime；在 Xcode Settings / Components 中安装。"
    return result


def registry():
    if REGISTRY.is_symlink() or REGISTRY.parent.is_symlink():
        raise QAError("拒绝符号链接的 iOS 设备登记目录。")
    if not REGISTRY.exists():
        return {"schemaVersion": 1, "devices": {}}
    try:
        data = json.loads(REGISTRY.read_text())
        if data["schemaVersion"] != 1 or not isinstance(data["devices"], dict):
            raise ValueError()
        return data
    except (OSError, KeyError, ValueError):
        raise QAError("专属 iOS 设备登记损坏；保留现有数据，拒绝操作。") from None


@contextmanager
def registry_lock():
    if REGISTRY.is_symlink() or REGISTRY.parent.is_symlink():
        raise QAError("拒绝符号链接的 iOS 设备登记目录。")
    REGISTRY.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    lock = REGISTRY.parent / ".create.lock"
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise QAError("iOS 设备创建锁存在；确认其他任务是否仍在创建，不自动覆盖或删锁。") from None
    try:
        os.close(descriptor)
        yield
    finally:
        lock.unlink()


def write_registry(data):
    temporary = REGISTRY.parent / ("registry-" + uuid.uuid4().hex + ".tmp")
    try:
        private_text(temporary, json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        os.replace(temporary, REGISTRY)
    finally:
        temporary.unlink(missing_ok=True)


def valid_udid(udid):
    if not UDID_RE.fullmatch(udid):
        raise QAError("需明确的 Simulator UDID；不接受 booted、名称、实体设备或隐式目标。")
    return udid.upper()


def managed_device(tools, udid, data=None, require_booted=False):
    udid = valid_udid(udid)
    entry = registry()["devices"].get(udid)
    if not entry or not entry.get("name", "").startswith(PREFIX):
        raise QAError("该 UDID 未登记为本工具创建的专属 iOS Simulator，拒绝操作。")
    data = inventory(tools) if data is None else data
    matches = [(runtime, d) for runtime, devices in data["devices"].items() for d in devices if d.get("udid", "").upper() == udid]
    if len(matches) != 1 or matches[0][0] != entry.get("runtime") or matches[0][1].get("name") != entry["name"]:
        raise QAError("登记与 Simulator 实际设备身份不匹配，拒绝操作。")
    device = matches[0][1]
    if device.get("isAvailable") is not True:
        raise QAError("专属设备的 runtime 不可用；不创建替代或清除旧设备。")
    if require_booted and device.get("state") != "Booted":
        raise QAError("专属 iOS Simulator 未启动；先用明确 UDID 执行 boot。")
    return udid, entry, device


def create(tools, profile, device_type, runtime):
    if profile not in PROFILE_FAMILIES:
        raise QAError("未知屏幕分组；使用 compact-phone、large-phone 或 tablet。")
    data = inventory(tools)
    # No hard-coded type/runtime UUID or invented device model. Users select IDs
    # actually returned by their installed Xcode via profiles/list.
    runtimes = [r for r in available_runtimes(data) if r.get("identifier") == runtime]
    types = [t for t in family_types(data, PROFILE_FAMILIES[profile]) if t.get("identifier") == device_type]
    if len(runtimes) != 1 or len(types) != 1:
        raise QAError("必须选择 profiles/list 中实际存在的 iOS runtime 与对应 iPhone/iPad device-type。")
    name = PREFIX + profile
    with registry_lock():
        current = registry()
        if any(d.get("name") == name for ds in data["devices"].values() for d in ds) or any(d.get("name") == name for d in current["devices"].values()):
            raise QAError("同名专属设备已存在，保留旧设备与存档；不覆盖或重新创建。")
        response = simctl(tools, "create", name, device_type, runtime, timeout=120)
        udid = valid_udid(response.stdout.strip())
        current["devices"][udid] = {"name": name, "profile": profile, "deviceType": device_type,
                                    "deviceTypeName": types[0]["name"], "runtime": runtime,
                                    "createdAt": datetime.now(timezone.utc).isoformat()}
        try:
            write_registry(current)
        except OSError:
            raise QAError(f"已创建 {udid}，但登记写入失败；保留设备，不自动删除，请人工恢复登记。") from None
    managed_device(tools, udid)
    return {"udid": udid, **current["devices"][udid], "evidenceType": "IOS_SIMULATOR"}


def boot(tools, udid, timeout):
    if not 10 <= timeout <= 600:
        raise QAError("启动等待必须在 10 至 600 秒。")
    udid, entry, device = managed_device(tools, udid)
    if device.get("state") != "Booted":
        simctl(tools, "boot", udid, timeout=30)
    # A timeout never erases or deletes the device; this explicit UDID can be
    # inspected or shut down later. No global kill or implicit `booted` target.
    simctl(tools, "bootstatus", udid, "-b", timeout=timeout)
    managed_device(tools, udid, require_booted=True)
    return {"udid": udid, "name": entry["name"], "bootCompleted": True}


def shutdown(tools, udid):
    udid, entry, device = managed_device(tools, udid)
    if device.get("state") == "Booted":
        simctl(tools, "shutdown", udid, timeout=60)
    return {"udid": udid, "name": entry["name"], "shutdownRequested": True}


def open_url(tools, udid, url):
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or any(ord(c) < 32 for c in url):
        raise QAError("仅允许无账号信息的 http/https URL。")
    udid, _, _ = managed_device(tools, udid, require_booted=True)
    simctl(tools, "openurl", udid, url, timeout=30)
    return {"udid": udid, "openedHost": parts.hostname,
            "verified": "只发送 URL；必须截图和实际操作确认页面，不能视为宿主或游戏通过。"}


def simulator_app(path):
    original = Path(path).expanduser()
    if original.is_symlink() or original.suffix != ".app" or not original.is_dir():
        raise QAError("只接受明确的本地 Simulator .app 目录；不支持 IPA、App Store 真机包或符号链接。")
    app = original.resolve()
    info = app / "Info.plist"
    if info.is_symlink():
        raise QAError("拒绝符号链接 Info.plist。")
    try:
        with info.open("rb") as handle:
            metadata = plistlib.load(handle)
        platforms = metadata.get("CFBundleSupportedPlatforms", [])
        bundle = metadata.get("CFBundleIdentifier", "")
        if "iPhoneSimulator" not in platforms or metadata.get("DTPlatformName", "iphonesimulator") != "iphonesimulator" or not BUNDLE_RE.fullmatch(bundle):
            raise ValueError()
    except (OSError, ValueError, TypeError, plistlib.InvalidFileException):
        raise QAError(".app 未声明合法 iPhoneSimulator 平台与 bundle ID；请使用自己的 Simulator 构建。") from None
    return app, bundle


def install_app(tools, udid, path):
    app, bundle = simulator_app(path)
    udid, _, _ = managed_device(tools, udid, require_booted=True)
    simctl(tools, "install", udid, app, timeout=120)
    return {"udid": udid, "bundleId": bundle, "installCompleted": True,
            "scope": "仅自有 Simulator 构建；不包含 App Store TapTap 宿主验收。"}


def launch_app(tools, udid, bundle):
    if not BUNDLE_RE.fullmatch(bundle):
        raise QAError("bundle ID 格式无效。")
    udid, _, _ = managed_device(tools, udid, require_booted=True)
    simctl(tools, "launch", udid, bundle, timeout=30)
    return {"udid": udid, "bundleId": bundle, "launchRequested": True}


def capture(tools, udid):
    udid, entry, device = managed_device(tools, udid, require_booted=True)
    directory = evidence_dir("capture")
    screenshot = directory / "screen.png"
    simctl(tools, "io", udid, "screenshot", "--type=png", screenshot, timeout=30)
    if not screenshot.is_file() or screenshot.stat().st_size < 8 or screenshot.read_bytes()[:8] != b"\x89PNG\r\n\x1a\n":
        raise QAError("未取得有效 Simulator PNG 截图，不能标为采集成功。")
    screenshot.chmod(0o600)
    result = {"udid": udid, "name": entry["name"], "runtime": entry["runtime"],
              "state": device["state"], "output": str(directory),
              "evidenceType": "IOS_SIMULATOR", "releaseGate": "NOT_EVALUATED",
              "scope": "仅截图与设备身份，不采集账号数据、应用沙盒或全量日志。截图可能含账号界面，只保存在忽略的本地证据，禁止打印或提交。"}
    private_text(directory / "capture.json", json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


def parser():
    p = argparse.ArgumentParser(description=__doc__, epilog="安装入口：https://developer.apple.com/xcode/；先运行 doctor/profiles，再用输出中的真实 device-type/runtime ID 创建。")
    commands = p.add_subparsers(dest="command", required=True)
    commands.add_parser("doctor")
    commands.add_parser("profiles", help="输出已安装 iOS runtime 和实际可选 iPhone/iPad types；不虚构机型 ID")
    commands.add_parser("list", help="同 profiles，另列专属设备")
    c = commands.add_parser("create", help="创建专属 Simulator，不覆盖或清空旧记录")
    c.add_argument("profile", choices=PROFILE_FAMILIES)
    c.add_argument("--device-type", required=True)
    c.add_argument("--runtime", required=True)
    for name in ("boot", "shutdown", "open-url", "install-app", "launch-app", "capture"):
        s = commands.add_parser(name)
        s.add_argument("--udid", required=True, help="create 返回的明确 UDID，不接受 booted")
        if name == "boot":
            s.add_argument("--timeout", type=int, default=240)
        elif name == "open-url":
            s.add_argument("url")
        elif name == "install-app":
            s.add_argument("app", help="自有 Simulator .app，不支持 IPA")
        elif name == "launch-app":
            s.add_argument("--bundle-id", required=True)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        tools = xcode_tools()
        if args.command == "doctor":
            result = doctor(tools)
        elif args.command in ("profiles", "list"):
            result = public_inventory(inventory(tools))
            result["profiles"] = {k: {"family": v, "selection": "从以上实际 deviceTypes 选择小屏/大屏；不会将分组名自动等同特定机型"} for k, v in PROFILE_FAMILIES.items()}
        elif args.command == "create":
            result = create(tools, args.profile, args.device_type, args.runtime)
        elif args.command == "boot":
            result = boot(tools, args.udid, args.timeout)
        elif args.command == "shutdown":
            result = shutdown(tools, args.udid)
        elif args.command == "open-url":
            result = open_url(tools, args.udid, args.url)
        elif args.command == "install-app":
            result = install_app(tools, args.udid, args.app)
        elif args.command == "launch-app":
            result = launch_app(tools, args.udid, args.bundle_id)
        else:
            result = capture(tools, args.udid)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (QAError, OSError, ValueError) as exc:
        # OS failures may expose paths, but never print raw subprocess responses.
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
