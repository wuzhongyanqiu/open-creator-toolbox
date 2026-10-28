# 移动游戏设备测试

核对日期：2026-10-28。适用于工作区 H5 游戏的日常开发、每日优化与发布验收。

用户最新决定：**不下载Xcode，不继续安装iOS runtime。** 本机已装的Playwright WebKit用于H5兼容、触控布局和存档回归；iOS原生Simulator/TapTap宿主项标记 `SKIPPED_BY_USER`，不再因缺Xcode阻塞本轮Android/H5流程。该豁免仅针对iOS原生项，不降低存档、Android、真实平台服务和素材的其余发布要求，也不能宣称iOS宿主已通过。

每次更新均强制执行 [老玩家存档兼容与平滑迁移](GAME_SAVE_COMPATIBILITY.md)：旧版写档后升级最终候选，逐字段核对并重复启动；迁移失败保留原始档。新安装正常、同版本刷新正常都不能替代跨版本验收。

先跑浏览器矩阵，再在 Android 虚拟设备中的正式 TapTap 客户端验证宿主与平台接口；物理手机或云真机补充厂商系统、实际 GPU、触控、音频和温升测试。模拟器能推进大量之前没有环境的检查，但测试结果必须注明环境，不能将未执行的项目标为通过。

## 能力与路由

| 环境 | 可执行的测试 | 不能据此证明的内容 |
| --- | --- | --- |
| Playwright / Chrome 设备模拟 | 屏幕、DPR、触控、横竖屏、DOM 页面、项目定义的操作流程、错误和布局诊断 | Android WebView / TapTap 原生宿主、真实广告、排行榜服务、特定手机性能 |
| Playwright WebKit（本机已装） | 第二浏览器引擎的H5、CSS、触控布局、WebAudio接口与浏览器存档兼容 | 桌面WebKit不等于具体iOS版本的Safari、iPhone硬件或TapTap iOS宿主 |
| 官方 Android Emulator ARM64 | Android 系统与 WebView、正式 TapTap APK、前后台/返回/断网、截图与 UI 层级、实际平台接口尝试 | AVD 的屏幕和 RAM 配置不是小米/华为/OPPO 的 ROM、GPU 或散热；广告商可能限制模拟环境 |
| Xcode iOS Simulator | Safari / WebKit、iPhone/iPad 外形、自有 Simulator 构建 | 第三方 App Store 真机包不等于 Simulator 构建；不能承诺可安装 iOS TapTap |
| 本地物理设备 | TapTap 真机操作、实际 GPU/音频/触控、长时间运行 | 单台通过不代表所有品牌和版本 |
| Android Device Streaming / Google DDP | 云端物理 Android，多设备 ADB 与远程操控 | 需要账号、项目、权限、配额及适用账单；未开通不写已可用 |
| BrowserStack App Live | 云端物理 Android/iOS 的 App 安装和操作 | Live 是网站测试，App Live 才是 App；账号、套餐、安装及登录限制逐次核对 |

Apple Silicon 使用 ARM64 系统镜像。调整通用屏幕尺寸可以查适配问题，不能据此宣传“已覆盖所有品牌机型”。当前配置先覆盖 Android 15 / API 35；其他 Android 版本须另装匹配镜像并实际执行，不能只改报告里的版本号。

官方依据：[Android 加速与架构](https://developer.android.com/studio/run/emulator-acceleration)、[AVD 配置](https://developer.android.com/studio/run/managing-avds)、[网络/传感器](https://developer.android.com/studio/run/emulator-extended-controls)、[Chrome 模拟边界](https://developer.chrome.com/docs/devtools/device-mode/)、[Apple 构建平台区分](https://developer.apple.com/documentation/technotes/tn3117-resolving-build-errors-for-apple-silicon)。

## 一、浏览器矩阵

使用游戏仓库已经锁定的 Playwright，不向游戏增加依赖、不复用用户登录浏览器。先按游戏自身命令启动最终生产构建的本地预览，再运行：

```sh
npm run qa:browser -- --profiles
npm run qa:browser -- \
  --project /absolute/path/to/game \
  --url http://127.0.0.1:5173 \
  --out /absolute/path/to/game/output/mobile-qa/unique-run \
  --scenario /absolute/path/to/game/scripts/mobile-scenario.mjs
```

默认五种配置：360×640、390×844、412×915、844×390 横屏、1024×768 平板，明确记录触控与 DPR。它们是浏览器配置，不是实际手机型号。输出初始/结束截图、脚本与来源 commit、错误/请求诊断、横向溢出、按钮出界/尺寸/中心遮挡及 Canvas 分辨率线索；小按钮、Canvas、视觉清晰度与交互合理性仍需结合实际画面审查。

`--engine chromium` 为默认；本机已有WebKit时用 `--engine webkit` 运行同一配置/场景，不下载新依赖。两套结果分别保存，不能将Chromium结果填为WebKit通过。WebKit只作Safari相关H5兼容线索，正式的iOS系统/原生宿主仍按用户决定跳过。

`--scenario` 为本地 ESM，默认导出 `async ({ page, profile, outputDir }) => ({ checks, covered, unverified })`。`checks` 必须包含实际执行的 `{ name, passed }`，`covered` 说明覆盖的真实流程。见 `scripts/mobile-qa/example-scenario.mjs`；示例是接入协议，不是任何一款游戏已完成验收。

没有场景最多为 `SMOKE_PASS`；场景执行成功为 `SCENARIO_PASS`，只覆盖返回的检查。**两者的 `releaseGate` 都是 `NOT_EVALUATED`**，不会仅凭截图自动批准发布。每款游戏要补齐自己的启动、首局、结算、存档、重试、设置、返回等场景；正式 ZIP 与预览来源需另做身份核对。

默认仅允许 loopback 页面与网络请求，阻止测试页面向生产分析/广告/排行榜发送事件。确需访问外部服务时显式传 `--allow-remote` 并核对实际影响；它会允许外部请求，不代表已登录或已批准写正式榜。输出目录必须新建或为空。运行证据不提交 Git。

## 二、本地 Android 虚拟设备

CLI 仅管理 `creator-qa-*` 且带专属标记的 AVD，不覆盖用户已有设备，不 wipe、不清空存档、不全局重启 ADB。所有后续操作必须提供 `start` 返回的 `--serial`；会在线核对 AVD 归属，拒绝实体设备和其他虚拟机。

```sh
npm run qa:android -- doctor
npm run qa:android -- profiles
npm run qa:android -- create compact-phone
npm run qa:android -- create tall-phone
npm run qa:android -- create tablet
npm run qa:android -- start creator-qa-compact-phone --timeout 240
# 根据实际 start 输出选择 serial，不假定永远是 5554。
npm run qa:android -- status --serial emulator-5554
npm run qa:android -- install-apk --serial emulator-5554 /absolute/path/to/official-taptap.apk
npm run qa:android -- launch-app --serial emulator-5554 --package com.taptap
# 在客户端内搜索游戏或使用该版本实际支持的候选包入口。
# open-url 只发送 VIEW intent，未必进入 TapTap；仅用于明确核对过的页面。
npm run qa:android -- open-url --serial emulator-5554 http://10.0.2.2:5173
npm run qa:android -- capture --serial emulator-5554
npm run qa:android -- stop --serial emulator-5554
```

三种通用 Android 屏幕配置位于 [mobile-device-profiles.json](mobile-device-profiles.json)：360×640 dp、390×844 dp、800×1280 dp。系统状态栏和导航栏会占空间，WebView 实际 CSS 视口要在游戏里回读，不能直接等同这些 dp。一次启动一台以减少资源竞争，测试完停止。默认无窗口、无音频、SwiftShader 软件 GPU，适合自动截图/流程；`start --window` 可查看窗口。此默认运行不验收扬声器、蓝牙、物理触控、手机 GPU 或温升。

截图、UI XML、限定错误日志、启动记录写入忽略的 `output/mobile-qa/`；可能包含账号界面，只作为本地证据，不打印/提交凭据、账号痕迹或全量日志。Canvas 可能没有可操作的 UI 节点，应结合截图和实际输入；UI 层级采集失败会非零退出，不能伪称完整证据。

宿主的日常操作可在确认专属 serial 后使用 ADB 的 `input tap`、`input swipe`、`input keyevent`；包体和进度均限专属 AVD。使用本地服务器时 Android Emulator 的 `10.0.2.2` 指向宿主回环地址；直接用设备内 `127.0.0.1` 不会访问 Mac 的服务器。需要屏幕录像可用官方 `adb shell screenrecord`，保存与回收仅限专属运行文件，不清理设备的其他数据。

### 安装依赖

本机安装与真实验收结果以本节末尾记录为准；下列命令是复现入口，不是自动成功证明。

```sh
# Homebrew 用户；Google SDK/系统镜像受各自许可约束。
brew install openjdk@21
brew install --cask android-commandlinetools
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
android --no-metrics --sdk="$HOME/Library/Android/sdk" sdk install platform-tools
android --no-metrics --sdk="$HOME/Library/Android/sdk" sdk install emulator
android --no-metrics --sdk="$HOME/Library/Android/sdk" sdk install system-images/android-35/google_apis/arm64-v8a
```

也可从 [官方 Android Studio / Command-line Tools](https://developer.android.com/studio) 安装，将命令行工具放在 SDK 的 `cmdline-tools/latest/`。`doctor` 支持 `ANDROID_HOME` / `ANDROID_SDK_ROOT`、标准用户 SDK 目录和 Homebrew 路径，不要求修改用户 shell 配置。依赖、AVD、APK、镜像和许可接受记录留在本机，不进仓库。

本次官方 Command-line Tools 23.0 已将 `sdkmanager` 改为 Android CLI 的兼容入口，`--licenses` 仅提示“不再需要”，不能把该命令退出0当成已接受或校验所有许可。按 [Android CLI 官方文档](https://developer.android.com/tools/agents/android-cli) 与实际安装时条款执行，使用 `--no-metrics` 关闭 CLI 使用指标。旧版命令行工具仍可按它的 `sdkmanager --help` 使用旧语法，不在本任务里自动升级已有用户 SDK。

中国区 TapTap APK 入口为 [官方稳定下载](https://d.taptap.cn/latest)，来源为 [官方分发页](https://dispatch.taptap.cn/)。下载后记录重定向目标、SHA256、实际包名/版号/ABI，再显式 `install-apk`。不能用国际版或第三方 APK 站冒充中国正式宿主；不绕过登录、验证或模拟器限制。专用测试账号的登录和授权按平台实际流程完成，不自动提取用户已有账号凭据。

`launch-app` 解析已安装包的实际 Launcher 并验证组件归属，不猜 Activity 类名。本次客户端对 `https://www.taptap.cn/app/<ID>` 没有可直接匹配的 App Link Activity；因此不能把 `open-url` 返回成功写成已在 TapTap 内打开了游戏。使用客户端内搜索或平台当前提供的真实测试入口，并截图/回读确认实际进入。

## 三、TapTap 宿主检查

工作区当前游戏是 H5，必须沿用对应项目实际 H5 SDK。不要把 Tap 小游戏的 `tap` API 或其他形态的示例直接套进现有 H5。参考 [H5 广告适用说明](https://developer.taptap.cn/minigameapidoc/quick-start/mcp-guide/ad-integration-guide/)。TapTap 没有在本次核对的文档中承诺模拟器全面支持，必须以实测为准。

1. 记录测试来源 commit、最终 ZIP 哈希、TapTap 客户端实际版本、Android API/ABI、AVD 配置、入口及版本。
2. 在平台提供的候选包测试入口打开候选，不能用当前旧线上游戏冒充候选。走完整首局、返回、存档恢复、奖励结算和重复进入。
3. 广告使用实际平台配置，验证加载、首次/再次播放、提前关闭不发奖、完播恰好发奖一次、超时/错误恢复；明确测试广告还是真实生产库存。模拟回调、没有填充或环境不支持均不能标作真实广告成功。
4. 排行榜用已授权专用测试账号的正常游戏成绩验证提交、回读、开榜、赛道/单位、公开范围、双账号可见性和失败重试，不清正式榜、不伪造测试高分。缺账号、权限或数据就标未验收。
5. 检查弹窗/原生覆盖层关闭、前后台、断网/恢复、横竖屏、按钮可达、触控、清晰度；只有实际走通的流程才记 `PASS`。

Android 虚拟设备中执行的真实宿主与服务请求可以作为该环境的集成证据，能推进功能、布局和平台接入检查。它不自动覆盖物理性能和特定厂商兼容。根据本次变更逐项判断是否必须补物理设备证据：涉及手机性能、触控/音频差异、GPU、温升或厂商特有故障必须补；仅因没有实体手机，不应停止本可在模拟器执行的检查。未执行、被环境限制或缺少本次必需证据的项目仍不得放行，不能静默降低用户的发布要求。

## 四、云真机补充

- [Android Device Streaming](https://developer.android.com/studio/run/android-device-streaming) / [Google Developer Device Platform（DDP）](https://cloud.google.com/products/developer-device-platform)：物理 Android，需项目、权限、配额和当前计费核对。DDP 有 [官方 Agent Skill](https://docs.cloud.google.com/developer-device-platform/agent-skill)，可在另行配置账号/授权后接入，当前未安装或开通。
- [BrowserStack App Live](https://www.browserstack.com/docs/app-live/overview/introduction)：物理 Android / iOS 的 App 测试，检查目标机型、包安装、商店可用性及账号限制，不自动购买套餐。
- Firebase Test Lab 已在 2026-10-27 公告弃用，计划 2027-09-30 关闭；新长期流程优先 DDP。Android Device Streaming 继续支持，不能把 Test Lab 弃用误写成云真机全部关闭。见 [迁移公告](https://firebase.google.com/docs/test-lab/migrate) 与 [FAQ](https://firebase.google.com/docs/test-lab/migrate-faq)。

## iOS Simulator 管理与安装

`npm run qa:ios` 支持 `doctor / profiles / list / create / boot / shutdown / open-url / install-app / launch-app / capture`。需要完整Xcode和已安装的iOS runtime，单独Command Line Tools不包含simctl。工具只为子进程选择 `DEVELOPER_DIR`，不修改全局 `xcode-select`；用实际 `profiles` 列出的type/runtime ID，不凭空写一个机型或系统UUID。

```sh
npm run qa:ios -- doctor
npm run qa:ios -- profiles
npm run qa:ios -- create compact-phone --device-type <实际iPhone-type-ID> --runtime <实际iOS-runtime-ID>
npm run qa:ios -- create large-phone --device-type <实际大屏iPhone-type-ID> --runtime <实际iOS-runtime-ID>
npm run qa:ios -- create tablet --device-type <实际iPad-type-ID> --runtime <实际iOS-runtime-ID>
npm run qa:ios -- boot --udid <create返回的UDID>
npm run qa:ios -- open-url --udid <UDID> http://127.0.0.1:5173
npm run qa:ios -- capture --udid <UDID>
npm run qa:ios -- shutdown --udid <UDID>
```

设备操作只接受私有登记中且与simctl实际名称/runtime一致的专属UDID，拒绝 `booted`、用户已有模拟器和物理手机。重开同一专属设备保留存储；不delete、erase或重建来规避存档失败。登记与截图在忽略的 `output/mobile-qa/`，不能删除登记后把旧设备当不存在重新创建。

Safari可验证WebKit、iOS视口与浏览器存储；自有原生包装可用 `install-app --udid <UDID> /absolute/SimulatorBuild.app`、`launch-app --udid <UDID> --bundle-id <ID>`。只接受Info.plist声明iPhoneSimulator的平台构建，IPA、真机/App Store包不是替代。Safari网页正常不能代替TapTap iOS原生宿主的广告、排行榜与存储容器验收；后者仍需可用宿主Simulator构建或物理/云iPhone。

本机2026-10-28实查：macOS26.5、仅CLT，`doctor.ready=false`，尚无可启动的iOS runtime。App Store当前最新版Xcode要求macOS26.6；[苹果兼容表](https://developer.apple.com/xcode/system-requirements)列出Xcode26.6支持macOS26.2—26.x，未来可从[苹果旧版下载](https://developer.apple.com/download/all/?q=Xcode)选择兼容版本。注意这是 **Xcode26.6** 与 **macOS26.6** 两种不同版本。用户随后取消下载，本次未下载或安装Xcode，不再等待Apple登录；iOS管理脚本仅作为以后可选入口。参考[官方安装说明](https://developer.apple.com/documentation/safari-developer-tools/installing-xcode-and-simulators)和[runtime组件安装](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components)。

完成完整Xcode的官方首次初始化后，在Settings / Components下载匹配iOS runtime，再执行doctor、实际创建设备/启动/Safari/截图，分别留证。不会自动接受新许可、执行系统升级或使用非官方Xcode包绕过账号限制。当前iOS管理脚本27项单测通过，只证明隔离和参数/错误处理；缺Xcode时没有实际iOS启动验收。

## 五、发布证据与每日任务

每轮记录 `browserEmulation`、`webkitCompatibility`、`androidEmulatorHost`、`iosSimulator`、`saveCompatibility`、`physicalDevice`、`platformAds`、`platformLeaderboard`、`visualReview`、`packageIdentity`、`storeMedia` 和 `postPublication` 分项，状态为 `PASS / FAIL / UNKNOWN / NOT_APPLICABLE / SKIPPED_BY_USER`。后两种必须写理由和对应用户授权；当前仅iOS原生检查获得跳过授权。门禁由最终发行记录汇总，任一适用的必检项失败或未知都阻止发布；工具的 `SMOKE_PASS` / `SCENARIO_PASS` 不直接改成门禁 PASS。

每日任务使用最近有效的配置，优先重现真实问题、运行项目场景与候选宿主测试。最终正式包和素材必须同版本；确认精确新包上线、线上关键路径复核通过后，按 [宣发规范](GAME_PROMOTION_GUIDELINES.md) 发布更新帖，实际关联原生话题/tag 并回查，记录链接防重复。运行数据、截图和 APK 始终不提交。

## 本机核验记录

2026-10-28 在 macOS Apple Silicon 上实际执行，依赖由官方归档安装在用户 Android SDK 目录；未安装 Android Studio GUI 或 Xcode，未改用户 shell 配置。系统镜像与模拟器归档按官方元数据的长度、SHA1核对，另记SHA256；使用 Emulator 稳定channel-0，非预览版。

| 项目 | 本次实际结果 |
| --- | --- |
| 运行时 | JDK21.0.13.0.3、Command-line Tools23.0、ADB37.0.1、Emulator37.2.12稳定版、Android15/API35 Google APIs ARM64 rev9；Hypervisor.Framework加速检查通过 |
| 三种AVD | 小屏720×1280/320dpi、长屏780×1688/320dpi、平板1200×1920/240dpi均冷启动成功；回读wm尺寸/密度，截图PNG尺寸一致，UI层级采集通过；测试结束逐台停止 |
| TapTap宿主 | 中国官方APK包名com.taptap、版本2.96.15-rel#200100、versionCode296152001、ARM64；小屏已完成首次初始化进入游客首页，长屏安装与解析实际Launcher启动通过 |
| 网络与隔离 | ADB5037及模拟器5554/5555监听已核对仅回环；仅专属AVD。小屏首次初始化期间尝试宿主现有代理，结束恢复原guest代理配置 |
| 浏览器脚本 | 独立本地示例开始→操作→结果→重玩，五配置均SCENARIO_PASS；只证明runner/示例协议可用，releaseGate仍NOT_EVALUATED，不等于11款游戏验收 |
| WebKit替代 | 使用已装WebKit2359，五配置开始→操作→结果→重玩通过；缺引擎明确失败不下载/不降级；存档工具两引擎各10项回归及鉴宝0.14.1→0.14.3选定脱敏存档保留通过；iOS原生按用户要求跳过 |
| 卡死回归 | 本地主线程无限循环：小屏配置按1秒阶段上限记FAIL，其余四配置继续；约5.04秒以非0退出。正常五配置场景再次通过，约2.47秒；只关闭本轮独立浏览器进程 |
| 工具箱界面 | 桌面新增“设备测试”分类和三项工具显示/筛选通过，Rust固定启动白名单覆盖Android Studio；现有桌面启动器最小宽度560px，未宣称390px移动端页面通过 |
| 代码验证 | 33项Python单测、两份JS语法、目录校验、TypeScript/生产构建、Rust测试通过；CI加入目录与QA校验 |
| 未验收 | 没有登录专用测试账号、未实际验证游戏候选完整流程、真实广告库存/完播、双账号榜单、手机音频/触控/GPU/温升；未租用云真机 |

本地详细证据在忽略的 `output/mobile-qa/installation-acceptance.json` 及其引用的截图/诊断目录，APK、镜像、账号界面和日志不提交。五种浏览器配置和三种AVD是可复用测试入口，不能将工具接通写成所有游戏已经通过。浏览器工具箱页面复核期间Ego空间197随后不可用，按技能未重建替代空间；已完成的桌面证据保留，工具提示更新但未升级。
