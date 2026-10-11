# 五款游戏共用资产工具链

更新日期：2026-10-12

这份清单服务于当前五款 TapTap H5 游戏，也作为后续新游戏的默认资产基线。它区分工具软件许可、模型权重许可、下载素材许可和参考声音授权；四者不能互相替代。

## 结论

默认采用以下主链：

| 资产 | 默认工具链 | 发布格式 | 默认许可策略 |
| --- | --- | --- | --- |
| 角色立绘与 CG | Krita + ComfyUI/Invoke + FLUX.1 Schnell | WebP/PNG | 自绘或 Apache-2.0 权重；保存提示词、模型哈希和人工修改记录 |
| 像素画 | Pixelorama，LibreSprite 作为备选 | PNG 精灵表 + JSON | 自制；外部素材优先 CC0 |
| 3D 角色 | MakeHuman 官方核心资产 + Blender | GLB | MakeHuman 核心资产 CC0；社区扩展逐件核对 |
| 3D 场景与道具 | Blender + Poly Haven/ambientCG/Kenney | GLB + WebP/KTX2 | 优先 CC0；生成式草模必须人工重拓扑 |
| 配音 | OpenVoice 或 CosyVoice + Audacity | OGG/AAC/WAV 源档 | 只使用自有或书面授权音色；记录模型和参考音频授权 |
| BGM | MuseScore/LMMS + Ardour/Audacity | OGG 循环 + WAV 母版 | 自行作曲；采样、SoundFont、插件逐项核对 |
| 音效 | 自录 + Freesound CC0 + Audacity | OGG/WAV | 默认 CC0；CC-BY 必须进入署名清单；排除 BY-NC |
| 实机视频 | OBS + Kdenlive + FFmpeg | H.264 MP4 | 只使用已登记的游戏资产、音乐与字体 |
| 3D 优化 | glTF Transform + gltfpack + KTX-Software | GLB/KTX2 | 工具链许可明确；运行时解码能力必须真机验证 |

## 许可分级

- `clear`：可进入商业制作。仍然保存许可证原文、来源 URL、下载日期和文件哈希。
- `verify`：程序本身可用，但模型、插件、权重、社区资产、采样或署名要求必须逐项核对。
- `restricted`：仅研究、内部原型或情绪参考，不进入正式发布包。

不要把“代码开源”理解成“模型权重可商用”，也不要把“网站免费”理解成“素材可随游戏分发”。机器目录位于 `docs/game-asset-catalog.json`，提交前运行 `npm run catalog:check`。

## 五款游戏落地顺序

### 叠塔守卫

1. 用 Blender 重做三系塔、怪物和首领的低多边形模型，先建立统一轮廓语言。
2. 场景材质优先从 Poly Haven、ambientCG 取 CC0 基础，再进行风格化重绘。
3. 用 glTF Transform/gltfpack 输出移动端 GLB；单个普通单位建议控制在 8k-20k 三角形，首领 30k-50k，贴图以 1K 为主。
4. 保留现有 2D 版本作为低配降级；3D 版必须在 TapTap Android WebView 真机测试。

### 山海异兽急诊录

1. Krita 统一六只异兽的形体、笔触、边缘光和诊疗器具设计。
2. ComfyUI/Invoke 只做构图变体、背景延展和局部重绘，最终角色由人工 paint-over 定稿。
3. 用 OpenVoice/CosyVoice 生成已授权的异兽短句与旁白，再由 Audacity 做响度、降噪和气口调整。
4. 档案 UI 可采用 Game-icons.net，但作者与图标名称必须进入鸣谢清单。

### 零点回声

1. 优先补全三位男主的表情差分、姿态差分和关键 CG，而不是立即转全 3D。
2. OpenVoice/CosyVoice 制作角色样音；Rhubarb 输出口型时间轴，连接立绘眨眼、呼吸和嘴型状态。
3. 雨声、列车、磁带和电台底噪优先自录或使用 Freesound CC0，避免 BY-NC。
4. Kdenlive 制作剧情预告与 TapTap 实机视频，确保画面主要展示实际互动而非纯 CG。

### 雾港夜市

1. 采用 Blender + Kenney/Quaternius 的低多边形工作流，优先制作摊位、灯笼、食材和街道模块。
2. Quaternius 2026 年启用 QAL 1.0；可以用于商业游戏，但不要把原始包作为素材库再分发，并保存下载时的许可快照。
3. BGM 用 LMMS/MuseScore 自行编写七夜主题变奏；海浪、雨棚、锅铲和人群声使用自录或 CC0。
4. 经营核心仍保持 2D UI，3D 只承担可检查的摊位与街区反馈，避免包体和加载时间失控。

### 星契回廊

1. 先用 Blender 制作舰桥、星门、遗物和召唤装置；角色维持高质量 2D 立绘，避免一次性转全 3D。
2. TripoSR/TRELLIS.2 只用于道具和场景草模，必须经过人工重拓扑、UV、材质统一和轮廓审核。
3. CG 采用统一的角色 LoRA/参考图工作流，但只有许可证明确、训练素材来源可说明的模型才能进入商业包。
4. 配音优先覆盖抽卡登场、技能和章节关键句，减少长对白的成本与听觉疲劳。

## 后续新游戏模板

每个仓库建议使用以下目录：

```text
assets/
  source/          # PSD/KRA/BLEND/WAV 等可编辑母版
  generated/       # AI 或程序生成的原始结果，不直接进游戏
  processed/       # 人工清理、重拓扑、调色和混音后的候选资产
  runtime/         # 最终 WebP/PNG/GLB/OGG/MP4
  licenses/        # 许可证文本、网页快照、授权书和署名清单
  manifests/
    assets.json    # 来源、作者、许可、哈希、用途、处理记录
```

建议的 `assets.json` 最小字段：

```json
{
  "id": "character-shenyan-neutral",
  "source": "self-created",
  "author": "studio",
  "license": "proprietary-original",
  "model": null,
  "referenceRights": "owned",
  "sha256": "...",
  "transformations": ["paint-over", "color-grade", "webp-export"],
  "credits": null
}
```

## 禁止默认进入商业成品

- MusicGen/AudioCraft 默认权重：代码是 MIT，但权重是 CC-BY-NC 4.0，只做内部情绪参考。
- FLUX.1 Dev 系列：官方仓库标注非商业许可；默认只选择 Apache-2.0 的 Schnell，除非另购商业授权。
- 未确认模型卡的 Civitai/Hugging Face 权重、LoRA、Embedding 和社区节点。
- Freesound 的 CC-BY-NC 音频，以及缺少作者/许可页面的转载音频。
- 未获授权的真人声音克隆、艺人肖像、现有游戏角色、商标和特定在世艺术家风格模仿。
- Mixamo、VRoid、Sketchfab 等“免费但并非开源/许可逐件不同”的资源，不纳入默认绿色清单。

## 官方依据

- Blender 许可与输出归属：https://www.blender.org/about/license/
- Godot MIT 许可：https://godotengine.org/license/
- Krita 许可与作品归属：https://krita.org/en/about/license/
- Pixelorama：https://github.com/Orama-Interactive/Pixelorama
- LibreSprite：https://github.com/LibreSprite/LibreSprite
- MakeHuman 分离许可：https://static.makehumancommunity.org/about/license.html
- OpenToonz BSD：https://github.com/opentoonz/opentoonz/blob/master/LICENSE.txt
- ComfyUI：https://github.com/Comfy-Org/ComfyUI
- Invoke：https://github.com/invoke-ai/InvokeAI
- FLUX.1 Schnell：https://huggingface.co/black-forest-labs/FLUX.1-schnell
- TripoSR：https://huggingface.co/stabilityai/TripoSR
- TRELLIS.2：https://github.com/microsoft/TRELLIS.2
- Kenney：https://kenney.nl/support
- Poly Haven：https://polyhaven.com/license
- ambientCG：https://docs.ambientcg.com/license/
- Quaternius 新许可：https://quaternius.com/license.html
- OpenGameArt：https://opengameart.org/content/faq
- Freesound：https://freesound.org/help/faq/
- OpenVoice：https://github.com/myshell-ai/OpenVoice
- CosyVoice：https://github.com/FunAudioLLM/CosyVoice
- GPT-SoVITS：https://github.com/RVC-Boss/GPT-SoVITS
- Rhubarb Lip Sync：https://github.com/DanielSWolf/rhubarb-lip-sync/blob/master/LICENSE.md
- LMMS：https://docs.lmms.io/user-manual/legal/license
- MuseScore Studio：https://github.com/musescore/MuseScore
- MusicGen 许可区分：https://github.com/facebookresearch/audiocraft/blob/main/model_cards/MUSICGEN_MODEL_CARD.md
- OBS：https://obsproject.com/help
- Kdenlive：https://github.com/KDE/kdenlive
- FFmpeg：https://www.ffmpeg.org/legal.html
- glTF Transform：https://gltf-transform.dev/
- meshoptimizer/gltfpack：https://meshoptimizer.org/gltf/
- KTX-Software：https://github.khronos.org/KTX-Software/license.html
- Google Fonts：https://developers.google.com/fonts/
- Game-icons.net：https://game-icons.net/faq.html
