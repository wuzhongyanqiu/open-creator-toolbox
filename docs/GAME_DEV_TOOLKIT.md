# 游戏制作 Agent 工具箱

更新日期：2026-10-28

这份文档写给在工作区里做游戏、改游戏的 Agent。很多"做不好"其实是因为没找到合适的工具，所以这里按"我现在要解决什么问题"来查。资产许可的细节（clear / verify / restricted 三档）以 [GAME_ASSET_PIPELINE.md](GAME_ASSET_PIPELINE.md) 为准，宣发视频见 [GAME_PROMO_VIDEO_PIPELINE.md](GAME_PROMO_VIDEO_PIPELINE.md)，机器可读目录见 [game-toolkit-catalog.json](game-toolkit-catalog.json)。

所有 Agent 先读 [全工作区视觉资产工作流](GAME_VISUAL_ASSET_WORKFLOW.md)：生图统一使用 SRI Image 2.5（正式资产默认 Sunburst、草稿可用 Flare），建模以 Blender 为主，可选 Tripo 草模；审图使用视觉模型与实机截图。该规范优先于旧脚本默认值和下文历史建议。

**每次更新必须保留老玩家存档并平滑迁移。** 开发和发布前阅读 [存档兼容规范](GAME_SAVE_COMPATIBILITY.md)，用实际上线旧版建立进度后升级候选，核对资源、解锁、任务和历史纪录；迁移失败保留原档，禁止用默认新档覆盖。存档兼容失败或未验收不放行。

## 0. 先查这张表

| 我要…… | 首选 | 备选 / 说明 |
| --- | --- | --- |
| 截图、录屏、自动试玩、验收 | Playwright（各游戏 devDeps 已装）+ Playwright MCP | `game-pipeline` skill 里有存档注入、拖线战斗、字号验收脚本 |
| 多屏幕、触控和页面卡住检查 | `npm run qa:browser -- --project <游戏仓库> --url <本地URL> --out <证据目录>` | 五种屏幕配置；接入项目场景后才能验证完整流程，见 [移动设备测试](GAME_MOBILE_TESTING.md) |
| Android 系统与正式 TapTap 宿主测试 | Android Emulator ARM64 + ADB；`npm run qa:android -- doctor` | 三种通用屏幕配置；真实 SDK 请求须实际执行，模拟器不是物理机 |
| iPhone / iPad 模拟器 | 完整 Xcode + iOS runtime；`npm run qa:ios -- doctor` | Safari / WebKit、自有Simulator构建；选择本机实际支持的type/runtime，不把App Store真机TapTap包当模拟器包 |
| 无Xcode的Safari相关H5兼容 | 已有Playwright WebKit；`qa:browser` / `qa:save` 加 `--engine webkit` | 用户已取消Xcode下载，iOS原生项按授权跳过；桌面WebKit不冒充iPhone或TapTap iOS宿主 |
| 验证更新不丢老记录 | `npm run qa:save -- --help` | 旧构建→同origin候选→两次重载，逐项核对进度/资源/解锁/纪录；见[存档兼容规范](GAME_SAVE_COMPATIBILITY.md) |
| 物理 Android/iOS、厂商 ROM、手机性能 | 本地手机；Android Device Streaming / DDP；BrowserStack App Live | 云服务需账号、权限和费用核对，未自动开通；iOS Simulator 不能承诺安装 App Store 的 TapTap 包 |
| 给录屏补上游戏声音 | `scripts/promo/webaudio-tap.js` | Playwright `recordVideo` **不录音**，现有商店视频全部是静音轨 |
| 生成 2D 立绘、背景、UI 图 | SRI Image 2.5：`gpt-image-2.5-sunburst` / `gpt-image-2.5-flare`（各仓库脚本显式 `--model`） | 参考图一致性走 `/v1/images/edits`；见 `game-pipeline` §1 |
| 像素精灵、行走帧、图块 | PixelLab MCP / Retro Diffusion API（付费） | 本地手工：Pixelorama / LibreSprite |
| 3D 道具、场景、低模 | Blender CLI（本机已装）+ mcp-for-blender | 草模可用 Tripo（独立 API Key 与许可核对）或 TripoSR/TRELLIS.2；随后回 Blender 清理、优化 |
| 游戏内音效（零素材） | ZzFX / jsfxr | 素材库：Sonniss GDC 包、Freesound CC0、Kenney |
| BGM | ACE-Step（Apache-2.0，本地） | MuseScore/LMMS 自作；MusicGen 权重非商用，禁止进包 |
| 配音 | VoiceStudio 编排 CosyVoice / GPT-SoVITS | IndexTTS2、Fish Speech 有商用门槛，见 §5 |
| 补间、缓动、UI 动效 | GSAP（2025-04 起全部插件免费商用） | React 侧可用 framer-motion；OpenMontage 里有 `gsap-*` skill |
| 粒子、后处理（three/R3F） | three.quarks、pmndrs `postprocessing` | OpenMontage 里有 `threejs-*` 共 12 个 skill |
| 骨骼动画 | Rive / Lottie（运行时 MIT） | Spine 需要编辑器授权，运行时不是免费的 |
| 关卡、地图 | LDtk（MIT）/ Tiled | Phaser 3 可以直接读 Tiled JSON |
| 图集打包 | free-tex-packer（MIT） | TexturePacker 为商业软件 |
| 性能排查 | Chrome DevTools Performance、Spector.js、stats.js / r3f-perf | 先模拟设备定位，再在物理手机/云真机核验；桌面节流不等于低端机 GPU/温升 |
| 逆向参考开源同类 | `rea/`（REA + Ghidra，已跑通） | 结论需人工复核，见 KANBAN 里的误报记录 |

## 1. 本机现状（未单独注明的条目沿用 2026-10-16 实测）

| 工具 | 状态 | 备注 |
| --- | --- | --- |
| ffmpeg 8.1（Homebrew） | 已装 | 有 libx264/x265/vpx/opus/svtav1、`zoompan`、`xfade`、`loudnorm`；**没有 drawtext、subtitles/ass**（缺 libfreetype/libass）。字幕用 `scripts/promo/caption-card.py` 渲染成 PNG 再 overlay；要原生字幕可装 keg-only 的 `ffmpeg-full` |
| cwebp | 已装 | 资产压缩统一用 Pillow（`compress-art.py`） |
| Blender | 已装（`/opt/homebrew/bin/blender`，2026-10-18 实测 5.2.2 LTS） | 可以 `blender -b -P script.py` 做程序化渲染 |
| Python 3.13 + Pillow 12.2、uv、bun、node、docker | 已装 | |
| Google Chrome + Playwright | 已装 | 各游戏仓库 `node_modules/@playwright/test` |
| Android Emulator + ADB + API35 ARM64 | 已装（2026-10-28 实测） | JDK21、官方命令行工具23.0、Emulator37.2.12、ADB37.0.1；三种专属屏幕配置均冷启动/尺寸回读通过；TapTap APK小屏游客首页通过，广告/榜单另验 |
| Playwright WebKit | 已安装（2026-10-28 可执行路径已核对） | 目标游戏依赖中可解析WebKit2359；两引擎结果分开，不等于iOS真机 |
| Xcode / iOS Simulator | 用户已取消安装 | 本机仅CLT/simctl缺失；qa:ios保留可选入口，iOS原生测试按授权跳过，不再等待Apple登录或自动下载 |
| OpenMontage | 已安装 | Remotion、HyperFrames、Piper TTS 都在；`.agents/skills/` 下有 90 个可直接读的 skill |
| Toonflow | 已安装 | 分镜工作台，`yarn start` 后访问 `127.0.0.1:10588` |
| VoiceStudio | 未常驻 | 默认端口 `127.0.0.1:3900`，用前先启动 |
| Godot、ImageMagick、gifski、whisper.cpp、yt-dlp、auto-editor | 未安装 | 需要时 `brew install gifski whisper-cpp yt-dlp`；Godot 目前没有项目在用 |

## 2. Agent 接入层：MCP 与 Skills

想让 Agent 直接操作工具，优先找已有的 MCP / Skill，别自己从头造。

| 名称 | 类型 | 用途 | 许可 / 成本 | 注意 |
| --- | --- | --- | --- | --- |
| Playwright MCP | MCP（已配置） | 浏览器截图、点按、TapTap 后台上传 | Apache-2.0 | 持久 profile，首次登录要用户手动完成 |
| [mcp-for-blender](https://github.com/ahujasid/blender-mcp)（原 blender-mcp） | MCP + Blender 插件 | 让 Agent 建模、摆场景、渲染 | MIT | `uvx blender-mcp` 仍能用；插件可以执行任意 Python，只在本地开 |
| [Phaser 4 skills](https://github.com/phaserjs/phaser/releases/tag/v4.0.0) | Skill 文件 | 28 个子系统 skill + v3→v4 迁移 | MIT | **本仓库还在 Phaser 3.90**，v4 skill 只能参考，不要直接按它写 |
| [Phaser Editor v5 MCP](https://www.phaser.io/news/2026/04/phaser-editor-v5-release) | MCP | 编辑器内的场景/资产操作 | 编辑器为商业软件 | 目前没有项目用编辑器 |
| [Phaser Game Agent](https://www.phaser.io/agent/mcp) | 远程 MCP | 云端沙盒造游戏 | 按分钟和积分计费 | 产物在云上，不适合现有仓库 |
| [PixelLab MCP](https://www.pixellab.ai/mcp) | 远程 MCP | 4/8 方向角色、动画、Wang 图块、VFX | 订阅制 | Token 走环境变量，不进仓库 |
| [Retro Diffusion](https://github.com/Retro-Diffusion/api-examples) | API + MCP | 像素图、动画、像素风低模 | 预付费；输出归用户 | 条款禁止用输出训练 AI |
| [awesome-gamedev-agent-skills](https://github.com/gamedev-skills/awesome-gamedev-agent-skills) | Skill 合集 | 74 个跨引擎 skill，含 Phaser/PixiJS/three.js | 见仓库 | 先 `--list` 预览，按需挑，别全量装 |
| [GameStudio](https://github.com/bullish0x/GameStudio) / [Claude-Code-Game-Studios](https://github.com/Donchitos/Claude-Code-Game-Studios) | 多 Agent 脚手架 | GDD、分工、QA 模板 | 见仓库 | 拿模板参考即可，别覆盖本工作区的分工（Opus 设计 / Devin 执行） |
| Godot MCP（[hybridindie](https://github.com/hybridindie/godot-mcp)、[gda](https://github.com/aigengame/godot-agent)） | MCP / CLI | 驱动 Godot 编辑器、无头校验 | MIT | 只有新项目用 Godot 时才需要 |
| OpenMontage `.agents/skills/` | 本地 Skill | `threejs-*`、`gsap-*`、`ffmpeg`、`playwright-recording`、`acestep`、`hyperframes*` 等 | 各 skill 自带 | 路径 `advanced_research/OpenMontage/.agents/skills/<name>/SKILL.md`，直接 read |

## 3. 按技术栈挑运行时库

| 仓库 | 技术栈 | 合适的补充库 |
| --- | --- | --- |
| 叠塔守卫、火线改装厂 | Phaser 3.90 + TS | Phaser 自带粒子/Tween/Camera shake；ZzFX 做零素材音效；Tiled 或 LDtk 出地图 |
| 星契回廊、零点回声、万象神庭 | React + R3F + three 0.186 | drei、three.quarks、`postprocessing`、GSAP、r3f-perf |
| 潮汐新城 | three 原生 | 同上（不用 R3F 的部分）；glTF Transform 压 GLB |
| 雾港夜市 | React DOM | GSAP / framer-motion、Lottie |
| 山海异兽急诊录 | 原生 TS | GSAP、Rive（异兽表情状态机） |
| 珍宝阁：鉴宝三连（treasure-pavilion） | Preact | GSAP、Lottie |
| 天际车城（skydrive-city） | three + Rapier | Rapier 调试渲染、stats.js |

手感（game feel）可以直接套的三层：命中停顿（hit-stop 40-80ms）、屏幕震动（随伤害缩放，加衰减）、数值飘字（tabular-nums 防抖）。各仓库 `IMPROVEMENT_PLAN.md` 里的"手感 P0"都可以按这三层逐项验收。

## 4. 美术资产生成路由

先遵守 [GAME_ASSET_PIPELINE.md](GAME_ASSET_PIPELINE.md) 的目录结构和许可分级，这里只补"用哪个生成器"。

| 资产 | 首选 | 许可要点 |
| --- | --- | --- |
| 立绘、CG、背景、UI | SRI Image 2.5（默认 `gpt-image-2.5-sunburst`）+ 人工修整 | 提示词写回 `docs/ART_PROMPTS.jsonl`；对外发布要按《人工智能生成合成内容标识办法》声明 |
| 像素精灵 / 动画帧 | PixelLab、Retro Diffusion | 付费产物归用户；不能拿去训练模型 |
| 3D 草模 | TRELLIS.2（MIT）→ Blender 重拓扑 | 生成结果必须人工清理拓扑和 UV |
| 3D 草模（云端） | Tripo；Meshy 为备选 | Tripo 使用独立 `TRIPO_API_KEY`，账号/额度/许可使用前核对；不能把 TripoSR 的 MIT 套到云服务。见视觉资产工作流 |
| 3D 草模（本地大模型） | Hunyuan3D 2.1 | 腾讯社区许可：**不适用于欧盟、英国、韩国**，月活超 100 万要单独申请，分发需附 Notice → `verify` |
| 程序化渲染 | Blender CLI | 星契回廊、叠塔已有 `build-*-asset.sh` 先例 |

## 5. 音频

| 用途 | 工具 | 等级 | 说明 |
| --- | --- | --- | --- |
| 代码合成 SFX | [ZzFX](https://github.com/KilledByAPixel/ZzFX)（MIT，<1KB）、[jsfxr](https://sfxr.me/) | clear | 星契回廊 backlog 里的"WebAudio 音效包（零素材）"直接用它 |
| SFX 素材 | [Sonniss GDC 包](https://sonniss.com/gameaudiogdc/) | clear | 免署名、可商用；**禁止用于 AI 训练**，也不能把素材本身再分发 |
| BGM 生成 | [ACE-Step](https://github.com/ace-step/ACE-Step)（Apache-2.0） | verify | 权重可商用，但训练数据来源没有担保；只用纯器乐，保存 prompt 和种子；OpenMontage 有 `acestep` skill |
| 视频配音效（Foley） | MMAudio | restricted | 代码 MIT，权重 CC-BY-NC，只能内部参考 |
| 视频配音效（Foley） | HunyuanVideo-Foley | verify | 腾讯社区许可，有地域限制 |
| TTS | CosyVoice / GPT-SoVITS（经 VoiceStudio） | verify | 见 VoiceStudio 文档；只用有授权的音色 |
| TTS | [IndexTTS2](https://github.com/index-tts/index-tts) | verify | B 站模型许可：月活超 1 亿或年收入超 10 亿元才要单独授权；必须随附许可副本；旧版 Index-TTS 商用需要事先登记 |
| TTS | Fish Speech / OpenAudio S1-mini | verify | 社区商用许可要求年收入低于 50 万美元；S1-mini 权重页写的是非商用，用前以下载时的许可为准 |
| TTS（云端） | 豆包 TTS、Azure、ElevenLabs | verify | 付费 API，按服务条款；OpenMontage 都有对应 skill |

## 6. 学习资源与参考

- 预告片剪辑：[Derek Lieu 博客](https://www.derek-lieu.com/blog)（开头第一镜、钩子要在前 10-15 秒、常见独立游戏预告错误）。
- 开源同类对照：各游戏仓库的 `docs/OSS_ANALYSIS.md`（REA 分析产物）。
- 素材站许可：Kenney、Poly Haven、ambientCG、Quaternius、OpenGameArt、Freesound、Game-icons.net，详见 GAME_ASSET_PIPELINE。

## 7. 维护规则

- 新增工具时同步改 `game-toolkit-catalog.json`，并运行 `npm run catalog:check`。
- 许可结论要附官方来源 URL 和核对日期；条款变了就改 tier，不在旧结论上叠补丁。
- "本机已装"只写实测过的；没测的写"未验证"。
