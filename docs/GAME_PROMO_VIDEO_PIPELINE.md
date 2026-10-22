# 游戏宣发视频工作流

更新日期：2026-10-16

游戏做好后，用这份文档出宣发视频：TapTap 实机录屏、宣传片，以及抖音 / B 站 / 小红书上的搞笑、抽象短视频。所有命令都在本机实测过（ffmpeg 8.1，没有 drawtext/libass）。工具许可沿用 [GAME_ASSET_PIPELINE.md](GAME_ASSET_PIPELINE.md) 的 clear / verify / restricted 三档。

**统一宣发要求（2026-10-23）**：所有游戏宣发必须添加相关 tag / 话题标签，并在发布后核对实际显示；具体规则见 [游戏宣发与话题标签规范](GAME_PROMOTION_GUIDELINES.md)。AI 声明、论坛分类不代替 tag。

## 0. 先修一个现有问题：商店视频都没有声音

2026-10-16 用 `ebur128` 测了全部 15 个商店 / 营销视频（`*/docs/store-assets/video/*.mp4`、`*/docs/store-assets/marketing/*.mp4`），积分响度都是 **-70 LUFS**，也就是带着一条静音 AAC 轨。原因是 Playwright 的 `recordVideo` 只录画面，不录声音。

修法：录制时加载 `scripts/promo/webaudio-tap.js`，它会把所有接到扬声器的 WebAudio 节点（以及 `<audio>` 元素）旁路接到 MediaRecorder，最后和画面合流。在叠塔守卫 dist 上实测，录出的视频响度为 -24.9 LUFS，有声音。

```js
const browser = await chromium.launch({ headless: true, executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 720, height: 1280 }, recordVideo: { dir: out, size: { width: 720, height: 1280 } } });
await context.addInitScript({ path: '<open-creator-toolbox>/scripts/promo/webaudio-tap.js' });
const page = await context.newPage();
// ……试玩脚本……
const audio = await page.evaluate(() => window.__promoAudio.stop());   // { base64, startedAt, mimeType }
await context.close();
writeFileSync(`${out}/game-audio.webm`, Buffer.from(audio.base64, 'base64'));
// 合流：startedAt 是首个 AudioContext 出现时的 performance.now()，作为 adelay
// ffmpeg -i page.webm -i game-audio.webm -filter_complex "[1:a]adelay=${Math.round(audio.startedAt)}:all=1,apad[a]" \
//   -map 0:v -map "[a]" -shortest -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart out.mp4
```

已知限制：音画偏差约 ±100ms，对节奏点要求高的片段要人工核对；跨域 `<audio>` 录不到。如果游戏默认静音，录制前先在存档里打开音效。

## 1. 平台红线（发布前逐条核对）

### TapTap（[游戏物料要求](https://developer.taptap.cn/docs/store/release/publish/material/)，2026-10-16 核对）

| 物料 | 规格 | 内容红线 |
| --- | --- | --- |
| 实机录屏（下载/试玩必填） | MP4/MOV，H.264/H.265，≤5GB，**15 秒 < 时长 ≤ 30 分钟**（建议 2 分钟内），短边 ≥540px，宽高比 21:9 到 9:21 | 前 5 秒必须出核心玩法，且连续展示 10 秒以上；前 30 秒里纯 CG/立绘/抽卡/过场不能超过 10 秒；**不能加游戏本体以外的配音和字幕**；可以加速、减速、拼接；不能有前贴片；后贴片只能放厂商和游戏 logo；不能有画中画（录屏占比 ≥80%）、拍设备、表情包遮挡、其他平台水印、营销诱导或充值折扣画面 |
| 宣传片 | 16:9 横屏，≥1280×720（建议 1920×1080），≥15 秒 | 以核心玩法为主；前 3 秒不能是 logo 或黑屏 |
| 宣传图 16:9 / 1:1 | ≥1920×1080 / ≥1440×1440，≤4MB | 只能出现游戏名这一处文字；不能直接用截图或简单拼贴；4:3 裁切线上不要放主体 |
| 截图 | 竖版 ≥720×1280，至少 3 张，单张 ≤4MB | 实机画面在前；概念或宣传图最多 2 张 |

结论：带花字的 `marketing/gameplay-titled-*.mp4` 只能发外站，**不能当 TapTap 实机录屏传**。TapTap 只传纯净录屏（`video/gameplay-*.mp4` 补上声音后的版本）。

### 国内短视频平台通用

- 竖屏 9:16、1080×1920、30/60fps、H.264 + AAC；响度统一到 **-14 LUFS / 峰值 -1.5 dBTP**。
- 前 1-3 秒必须有钩子（反转、数字爆炸、失败瞬间），不要用 logo 开场。
- 字幕和关键 UI 别放在顶部约 150px 和底部约 350px 内，那里会被平台按钮和标题挡住。
- **AI 标识**：《人工智能生成合成内容标识办法》2025-09-01 起施行。视频里有 AI 生成的画面、配音或音乐时，发布时要在平台上勾选或声明"AI 生成"，并在画面起始处加显著标识。不要去掉生成服务自带的标识和元数据。
- 其他平台的 logo、水印和导流不要混进来（例如抖音成片带着剪映水印再传 B 站）。

## 2. 视频类型与工作流

| 类型 | 用途 | 素材来源 | 推荐链路 |
| --- | --- | --- | --- |
| A. 纯净实机录屏 | TapTap 必传 | Playwright 试玩脚本 + webaudio-tap | `capture-store-assets.mjs` → 加音轨 → ffmpeg 剪辑提速 |
| B. 宣传片 / PV | TapTap 首页、B 站 | A 的高光片段 + 宣传图 | ffmpeg 横屏模糊底（§4.2）或 HyperFrames / Remotion 做标题卡 |
| C. 搞笑 / 抽象短视频 | 抖音、B 站、小红书 | A 的片段 + 花字 + 音效 | §3 的模板 + §4 的配方 |
| D. 角色整活短片 | 抖音、B 站 | 立绘 → 图生视频 → 对口型 | Wan2.2 / Seedance / Kling → LatentSync → 配音 |
| E. 开发日志 / 前后对比 | B 站、小红书 | Git 历史版本截图、`output/audit-*` | 前后对比分屏、版本号时间轴 |
| F. 多语言版本 | 海外 | A/B/C 成片 | VideoLingo（字幕翻译 + 配音） |

## 3. 搞笑 / 抽象短视频模板

每条视频只讲一个梗，控制在 8-20 秒。可以从这些套路里选：

| 模板 | 结构 | 适合的游戏 |
| --- | --- | --- |
| 预期反转 | "当你以为这关很简单"（0-3s）→ 定格放大 + "？？？"（1s）→ 2 倍速翻车或逆转 | 星契回廊连锁、叠塔元素反应、火线改装 |
| 数值爆炸 | 伤害数字越滚越大 + 连续震屏 + 音效叠加，结尾停在天文数字 | 火线改装厂、叠塔守卫 |
| NPC 内心戏 | 用 TTS 给顾客、异兽、敌机配"内心独白"吐槽 | 雾港夜市、山海异兽急诊录 |
| 一本正经胡说 | 纪录片腔解说（配音）配荒诞游戏画面 | 山海异兽急诊录、潮汐新城 |
| 失败合集 | 3-5 个翻车瞬间快切，每个配同一记重音 | 所有动作类 |
| 进化对比 | 美术 v0.1 和现在左右分屏，"这是同一个游戏" | 全部 8 款（已有历史截图） |
| 解压 ASMR | 无字幕、只有游戏音效的连锁或合成 | 珍宝阁三连、星契回廊 |
| 评论区接梗 | 用观众评论截图开头，再演示对应玩法 | 账号有评论之后 |

技巧（都在 §4 配方里）：定格 + 放大 + 重音、2 倍速、局部 punch-in、花字只在关键 1-3 秒出现。**搞笑音效一律从 Sonniss / Freesound CC0 / ZzFX 自己做**，网上流传的梗音效（myinstants 之类）大多没有授权，按 restricted 处理。

## 4. 实测配方

以下命令都在 `astral-pact-arcana/docs/store-assets/video/gameplay-720x1280.mp4` 上跑通过，产物经 ffprobe 和抽帧检查。

### 4.1 花字（替代 drawtext）

```bash
TB=/Users/elsie/Documents/advanced_research/open-creator-toolbox/scripts/promo
python3 $TB/caption-card.py --text "当你以为这关很简单" --out top.png --style meme --width 1080
python3 $TB/caption-card.py --text "？？？" --out boom.png --style impact --width 1080
python3 $TB/caption-card.py --text "一笔拖线，三机连爆" --out sub.png --style subtitle --width 1080
```

样式有 `meme`（白字黑描边）、`impact`（大黄字）、`subtitle`（半透明底条）、`title` 四种。**正式发布要传 `--font` 指定 OFL 字体**（如思源黑体或 Noto Sans CJK），脚本默认回落到系统黑体时会在 stderr 提示，那种成片只适合内部预览。

### 4.2 预期反转模板（9:16，正常 → 定格放大 → 2 倍速，含响度标准化）

```bash
ffmpeg -y -i in.mp4 -i top.png -i boom.png -i sub.png -filter_complex "\
[0:v]scale=1080:1920:flags=lanczos,setsar=1,split=3[a][b][c];\
[a]trim=0:6,setpts=PTS-STARTPTS[v1];\
[b]trim=start=6:duration=0.04,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1,scale=iw*1.15:-1,crop=1080:1920,setpts=PTS-STARTPTS[v2];\
[c]trim=6:12,setpts=(PTS-STARTPTS)/2[v3];\
[v1][v2][v3]concat=n=3:v=1:a=0[cat];\
[cat][1:v]overlay=0:180:enable='between(t,0,6)'[o1];\
[o1][2:v]overlay=(W-w)/2:(H-h)/2:enable='between(t,6,7)'[o2];\
[o2][3:v]overlay=0:H-h-260:enable='between(t,7,10)',fps=30,format=yuv420p[v];\
[0:a]atrim=0:6,asetpts=PTS-STARTPTS[a1];anullsrc=r=44100:cl=stereo,atrim=0:1[a2];[0:a]atrim=6:12,asetpts=PTS-STARTPTS,atempo=2[a3];\
[a1][a2][a3]concat=n=3:v=0:a=1,loudnorm=I=-14:TP=-1.5:LRA=11[a]" \
-map "[v]" -map "[a]" -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 160k -ar 44100 -movflags +faststart meme-9x16.mp4
```

定格那 1 秒的 `[a2]` 静音段可以换成重音音效：`-i boom.wav` 后用 `[4:a]atrim=0:1` 替代 `anullsrc`。

### 4.3 竖屏转 16:9 模糊底（TapTap 宣传片、B 站横屏）

```bash
ffmpeg -y -i in.mp4 -filter_complex "[0:v]split[bg][fg];[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=24:2,eq=brightness=-0.12[b];[fg]scale=-2:1080[f];[b][f]overlay=(W-w)/2:0,format=yuv420p[v]" -map "[v]" -map 0:a -c:v libx264 -crf 20 -c:a aac -movflags +faststart wide-16x9.mp4
```

### 4.4 局部 punch-in 放大（3-4.5 秒推近到 1.3 倍）

```bash
ffmpeg -y -i in.mp4 -vf "scale=1080:1920,zoompan=z='if(between(in_time,3,4.5),min(zoom+0.02,1.3),1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,format=yuv420p" -c:v libx264 -crf 22 zoom.mp4
```

### 4.5 GIF 预览、封面帧、响度检查

```bash
ffmpeg -y -ss 2 -t 4 -i in.mp4 -vf "fps=12,scale=360:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer" clip.gif
ffmpeg -y -ss 5 -i in.mp4 -frames:v 1 -q:v 2 cover.jpg
ffmpeg -hide_banner -i out.mp4 -af ebur128 -f null - 2>&1 | rg "^\s+I:" | tail -1   # -70 LUFS 就是静音
```

## 5. 工具清单

### 5.1 录制

| 工具 | 等级 | 用途 |
| --- | --- | --- |
| Playwright `recordVideo` + `webaudio-tap.js` | clear | 无头确定性录屏，可重复执行；OpenMontage 有 `playwright-recording` skill |
| [scrcpy](https://github.com/Genymobile/scrcpy)（Apache-2.0） | clear | 安卓真机 TapTap WebView 录屏（`--record`，Android 11+ 可录音），最接近玩家实际看到的画面 |
| OBS Studio | clear | 桌面录制、多源合成 |

### 5.2 剪辑与合成

| 工具 | 等级 | 适用 | 注意 |
| --- | --- | --- | --- |
| ffmpeg + `caption-card.py` | clear | 模板化批量出片 | 见 §4 |
| [HyperFrames](https://github.com/heygen-com/hyperframes)（MIT） | clear | 用 HTML/GSAP 写标题卡、动效字、片头片尾，渲染确定 | OpenMontage 已装，`hyperframes*` skill 共 7 个；`npx hyperframes render` |
| [Remotion](https://www.remotion.dev/docs/license/faq) | verify | React 写视频 | 个人或 ≤3 人公司免费商用，团队超过 3 人要买 Company License |
| Kdenlive | clear | 人工精剪 | |
| 剪映 + [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft) | verify | 批量生成剪映草稿后人工微调花字特效 | macOS 只能生成草稿，自动导出只能在 Windows；剪映素材、特效、字体的商用授权以剪映条款为准；导出别带水印 |
| [auto-editor](https://github.com/WyattBlue/auto-editor)（Unlicense） | verify | 自动剪掉静止、静音段 | 30.x 起多输入和 3200×1800 以上分辨率需要 license key |
| OpenMontage pipelines | verify（AGPL） | `screen-demo`、`clip-factory`、`animation`、`cinematic`、`localization-dub` | 必须先读 `AGENT_GUIDE.md` 再走 pipeline 和审批点 |
| Toonflow | verify | 剧情短片分镜、镜头节点 | 默认账号先改密码，不暴露端口 |

### 5.3 AI 生成

| 工具 | 等级 | 用途 | 注意 |
| --- | --- | --- | --- |
| [Wan2.2](https://github.com/Wan-Video/Wan2.2)（Apache-2.0） | verify | 本地图生视频（TI2V-5B 可在 4090 级显卡上跑 720P） | 本机是 Mac，需要远程 GPU；成片要做 AI 标识 |
| LTX-2、Seedance 2.x、Kling、MiniMax H3、Gemini Omni | verify | 云端角色整活、PV 镜头 | 付费 API，按各服务条款保存 ToS 快照；OpenMontage 里有对应 skill |
| [LatentSync](https://github.com/bytedance/LatentSync)（Apache-2.0） | verify | 立绘/视频对口型 | 只用于自有角色 |
| [LivePortrait](https://github.com/KlingAIResearch/LivePortrait) | restricted → verify | 立绘表情驱动 | 自带的 InsightFace 检测模型非商用；商用前要换掉（如 ComfyUI-LivePortraitKJ 的 MediaPipe 方案） |
| ACE-Step / Lyria / ElevenLabs Music | verify | 片段 BGM | 优先用游戏本身的 BGM，保持品牌一致 |
| CosyVoice、IndexTTS2、豆包 TTS、Azure | verify | 搞笑旁白、NPC 内心戏 | 不克隆真人、明星或声优；AI 配音要标识 |
| edge-tts | restricted | — | 非官方调用微软服务，没有商用授权 |
| MMAudio | restricted | — | 权重 CC-BY-NC |

### 5.4 字幕与多语言

| 工具 | 等级 | 用途 |
| --- | --- | --- |
| whisper.cpp（MIT，`brew install whisper-cpp`） | clear | 本地转写出 SRT，再由 `caption-card.py` 渲染 |
| [VideoLingo](https://github.com/Huanshere/VideoLingo)（Apache-2.0） | verify | 字幕切分、翻译、配音一条龙，出海版本用 |
| ffmpeg-full（keg-only） | clear | 想直接 `subtitles=` 烧录 ASS 时再装 |

### 5.5 一键成片工具（参考用）

[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)（MIT）和 [NarratoAI](https://github.com/linyqh/NarratoAI)（MIT）分别做"主题 → 文案 + 图库素材 + 配音"和"影视解说剪辑"。它们的默认素材来自通用图库，**不适合直接做游戏宣发**（TapTap 要求实机画面）。可以借鉴它们的字幕和配音编排，把素材源换成我们自己的录屏。

### 5.6 分发

| 工具 | 等级 | 用途 | 注意 |
| --- | --- | --- | --- |
| TapTap 后台 + Playwright MCP | — | 上传实机录屏、宣传片 | 按 `game-pipeline` skill §7 串行执行 |
| [social-auto-upload](https://github.com/dreammis/social-auto-upload)（`sau` CLI） | verify | 抖音、B 站、小红书、快手、视频号定时发布，自带 Agent skill | Cookie 存在本地，**绝不进仓库**；浏览器自动化有封号风险，先用小号验证 |
| `xiaohongshu-mcp`（工作区已克隆） | verify | 小红书图文、视频发布与数据 | 同上 |
| `daily-content-factory` | — | 已有的公众号 / 小红书图文流水线 | 可以加一个"游戏宣发"选题源 |

## 6. 交付检查清单

1. 画面全部来自当前版本实机，没有过度美化（TapTap 硬要求）。
2. 音轨不是静音（`ebur128` 积分响度在 -16 到 -12 LUFS 之间）。
3. TapTap 实机录屏没有外加字幕、配音和前贴片；外站版本的花字没压住游戏关键 UI。
4. 字体、音乐、音效、AI 模型都登记在 `assets/manifests/assets.json` 或仓库 `docs/` 里，并注明许可等级。
5. 用了 AI 生成内容的成片，已加显式标识，发布时也勾选了平台的 AI 声明。
6. 成片放在 `docs/store-assets/`（版本化物料）或 `output/`（临时产物，不提交）。上传结果（平台、时间、链接、版本号）追加到 `docs/RELEASE.md`。
