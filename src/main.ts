import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Blocks,
  BookOpen,
  Box,
  Camera,
  CircleAlert,
  CircleCheck,
  Clapperboard,
  createIcons,
  Download,
  ExternalLink,
  Files,
  Gamepad2,
  GitFork,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  Mic2,
  PackageOpen,
  PenTool,
  Play,
  RefreshCw,
  Route,
  ScanText,
  Search,
  SearchX,
  ShieldCheck,
} from "lucide";

type Category =
  | "image"
  | "pixel"
  | "3d"
  | "design"
  | "video"
  | "audio"
  | "voice"
  | "writing"
  | "resource"
  | "testing"
  | "document";
type LicenseTier = "clear" | "verify" | "restricted";
type Tool = {
  id: string;
  name: string;
  summary: string;
  replaces: string;
  categories: Category[];
  color: string;
  mark: string;
  url: string;
  web?: boolean;
  license?: string;
  licenseTier?: LicenseTier;
  licenseNote?: string;
};
type ToolStatus = { id: string; installed: boolean };

const tools: Tool[] = [
  {
    id: "android-studio",
    name: "Android Studio / Device Manager",
    summary: "Android 虚拟设备、不同屏幕与系统版本，以及 TapTap 宿主兼容测试",
    replaces: "移动设备测试",
    categories: ["testing"],
    color: "#478368",
    mark: "A",
    url: "https://developer.android.com/studio",
    license: "IDE Apache-2.0 / SDK 按 Google 许可",
    licenseTier: "verify",
    licenseNote: "虚拟设备不代表厂商真机；本地 CLI 与安装步骤见移动测试工作流。",
  },
  {
    id: "android-device-streaming",
    name: "Android Device Streaming",
    summary: "通过 Android Studio / DDP 连接云端物理 Android 设备",
    replaces: "多机型物理验收",
    categories: ["testing"],
    color: "#477e8b",
    mark: "D",
    url: "https://developer.android.com/studio/run/android-device-streaming",
    web: true,
    license: "Google Cloud 服务条款 / 按配额和用量计费",
    licenseTier: "verify",
    licenseNote: "需账号、项目和权限；使用前核对账单与配额，工具箱未代为开通。",
  },
  {
    id: "browserstack-app-live",
    name: "BrowserStack App Live",
    summary: "云端物理 Android / iOS 的 App 安装、操控与兼容性验证",
    replaces: "远程真机测试",
    categories: ["testing"],
    color: "#8c7051",
    mark: "B",
    url: "https://www.browserstack.com/docs/app-live/overview/introduction",
    web: true,
    license: "商业云测试服务",
    licenseTier: "verify",
    licenseNote: "App Live 可装 App；Live 网站测试不等于宿主测试。需账户和适用套餐。",
  },
  {
    id: "gimp",
    name: "GIMP",
    summary: "照片精修、图层合成与日常图像编辑",
    replaces: "Photoshop",
    categories: ["image"],
    color: "#6d7d54",
    mark: "G",
    url: "https://www.gimp.org/downloads/",
  },
  {
    id: "krita",
    name: "Krita",
    summary: "数字绘画、插画、漫画与逐帧动画",
    replaces: "Photoshop",
    categories: ["image"],
    color: "#b4567a",
    mark: "K",
    url: "https://krita.org/download/",
  },
  {
    id: "darktable",
    name: "darktable",
    summary: "非破坏 RAW 调色与摄影素材管理",
    replaces: "Lightroom",
    categories: ["image"],
    color: "#7567b2",
    mark: "d",
    url: "https://www.darktable.org/install/",
  },
  {
    id: "inkscape",
    name: "Inkscape",
    summary: "Logo、图标、SVG 与印刷矢量设计",
    replaces: "Illustrator",
    categories: ["design"],
    color: "#30363d",
    mark: "I",
    url: "https://inkscape.org/release/",
  },
  {
    id: "penpot",
    name: "Penpot",
    summary: "开放标准驱动的界面设计与交互原型",
    replaces: "Adobe XD",
    categories: ["design"],
    color: "#7a5af8",
    mark: "P",
    url: "https://design.penpot.app/",
    web: true,
  },
  {
    id: "scribus",
    name: "Scribus",
    summary: "书刊、海报与印刷级 PDF 排版",
    replaces: "InDesign",
    categories: ["design", "document"],
    color: "#39749b",
    mark: "S",
    url: "https://www.scribus.net/downloads/",
  },
  {
    id: "kdenlive",
    name: "Kdenlive",
    summary: "多轨剪辑、字幕、代理与基础调色",
    replaces: "Premiere Pro",
    categories: ["video"],
    color: "#3a7d89",
    mark: "K",
    url: "https://kdenlive.org/download/",
  },
  {
    id: "blender",
    name: "Blender",
    summary: "角色与场景建模、绑定动画、渲染、合成与动态图形",
    replaces: "After Effects",
    categories: ["3d", "video", "design"],
    color: "#e56b2f",
    mark: "B",
    url: "https://www.blender.org/download/",
    license: "GPL-3.0-or-later；创作输出归作者",
    licenseTier: "clear",
    licenseNote: "商用游戏资产可用；发布 Blender 插件时需遵循 GPL。",
  },
  {
    id: "natron",
    name: "Natron",
    summary: "节点式视觉特效与专业视频合成",
    replaces: "After Effects",
    categories: ["video"],
    color: "#416b78",
    mark: "N",
    url: "https://natrongithub.github.io/",
  },
  {
    id: "audacity",
    name: "Audacity",
    summary: "快速录音、波形编辑、降噪与导出",
    replaces: "Audition",
    categories: ["audio"],
    color: "#3f65b5",
    mark: "A",
    url: "https://www.audacityteam.org/download/",
  },
  {
    id: "ardour",
    name: "Ardour",
    summary: "多轨录音、混音与完整音频制作",
    replaces: "Audition",
    categories: ["audio"],
    color: "#a34545",
    mark: "A",
    url: "https://ardour.org/download.html",
  },
  {
    id: "pixelorama",
    name: "Pixelorama",
    summary: "像素角色、瓦片地图、逐帧动画与精灵表导出",
    replaces: "Aseprite",
    categories: ["pixel", "image"],
    color: "#7656a8",
    mark: "P",
    url: "https://orama-interactive.itch.io/pixelorama",
    license: "MIT",
    licenseTier: "clear",
    licenseNote: "适合直接制作商业游戏像素资产。",
  },
  {
    id: "libresprite",
    name: "LibreSprite",
    summary: "轻量像素画、调色板、帧动画与精灵表编辑",
    replaces: "Aseprite",
    categories: ["pixel", "image"],
    color: "#4f82a5",
    mark: "L",
    url: "https://libresprite.github.io/",
    license: "GPL-2.0",
    licenseTier: "clear",
    licenseNote: "软件可商用；若分发修改版软件需遵循 GPL。",
  },
  {
    id: "godot",
    name: "Godot",
    summary: "2D/3D 原型、动画预览、粒子特效与跨平台游戏制作",
    replaces: "Unity",
    categories: ["3d", "pixel", "design"],
    color: "#478cbf",
    mark: "G",
    url: "https://godotengine.org/download/",
    license: "MIT",
    licenseTier: "clear",
    licenseNote: "商业游戏可用；随游戏分发引擎时保留 MIT 声明。",
  },
  {
    id: "makehuman",
    name: "MakeHuman",
    summary: "快速生成人体基础模型，再进入 Blender 做风格化与服装",
    replaces: "Character Creator",
    categories: ["3d"],
    color: "#68737f",
    mark: "M",
    url: "https://www.makehumancommunity.org/content/downloads.html",
    license: "AGPL 软件 / CC0 核心资产",
    licenseTier: "verify",
    licenseNote: "官方核心资产与正规导出可用；社区附加资产逐件核对许可。",
  },
  {
    id: "opentoonz",
    name: "OpenToonz",
    summary: "二维角色动画、扫描上色、镜头表与特效合成",
    replaces: "Animate / Toon Boom",
    categories: ["image", "video"],
    color: "#2f677a",
    mark: "O",
    url: "https://opentoonz.github.io/e/",
    license: "BSD-3-Clause",
    licenseTier: "clear",
    licenseNote: "适合制作角色演出、立绘呼吸动画和 CG 镜头。",
  },
  {
    id: "obs",
    name: "OBS Studio",
    summary: "稳定录制实机演示、分层场景与高码率宣传视频素材",
    replaces: "商业录屏工具",
    categories: ["video"],
    color: "#303038",
    mark: "O",
    url: "https://obsproject.com/download",
    license: "GPL-2.0-or-later",
    licenseTier: "clear",
    licenseNote: "可商用且无水印；录制内容归项目方。",
  },
  {
    id: "lmms",
    name: "LMMS",
    summary: "循环 BGM、合成器、MIDI 编曲与游戏音乐草稿",
    replaces: "FL Studio",
    categories: ["audio"],
    color: "#559b63",
    mark: "L",
    url: "https://lmms.io/download",
    license: "GPL-2.0-or-later",
    licenseTier: "verify",
    licenseNote: "软件输出可商用；使用的采样、SoundFont 和插件需另行核对。",
  },
  {
    id: "musescore",
    name: "MuseScore Studio",
    summary: "主题旋律、管弦配器、乐谱与 MIDI/WAV 导出",
    replaces: "Sibelius",
    categories: ["audio"],
    color: "#2c6fb7",
    mark: "M",
    url: "https://musescore.org/download",
    license: "GPL-3.0",
    licenseTier: "verify",
    licenseNote: "软件可商用；MuseScore.com 乐谱和额外音源不是自动开放素材。",
  },
  {
    id: "rhubarb",
    name: "Rhubarb Lip Sync",
    summary: "从对白音频生成 2D 口型时间轴，适合立绘和 CG 对话",
    replaces: "手工口型标注",
    categories: ["voice", "video"],
    color: "#bd5d52",
    mark: "R",
    url: "https://github.com/DanielSWolf/rhubarb-lip-sync/releases",
    license: "MIT",
    licenseTier: "clear",
    licenseNote: "生成的口型数据归项目方，可用于商业游戏。",
  },
  {
    id: "inky",
    name: "Inky / ink",
    summary: "编写、试玩和编译多分支剧情，对 H5 可接入官方 JavaScript 运行时 inkjs",
    replaces: "散落在代码里的剧情分支",
    categories: ["writing"],
    color: "#35445a",
    mark: "ink",
    url: "https://github.com/inkle/inky/releases",
    license: "MIT",
    licenseTier: "clear",
    licenseNote: "适合零点回声、山海急诊和后续乙游的分支剧情源文件。",
  },
  {
    id: "vale",
    name: "Vale",
    summary: "把人名、术语、标点、禁用词和文风规范变成可在 CI 执行的文案检查",
    replaces: "人工逐篇检查文案一致性",
    categories: ["writing"],
    color: "#2d6d62",
    mark: "V",
    url: "https://vale.sh/",
    license: "MIT",
    licenseTier: "clear",
    licenseNote: "离线运行；建议为每个世界观维护专名表和 UI 字数规则。",
  },
  {
    id: "comfyui",
    name: "ComfyUI",
    summary: "复用节点工作流批量生成角色立绘、CG、贴图和风格变体",
    replaces: "不可复现的零散生图流程",
    categories: ["image", "3d", "video"],
    color: "#20242b",
    mark: "C",
    url: "https://www.comfy.org/download",
    license: "GPL-3.0（程序）",
    licenseTier: "verify",
    licenseNote: "每个模型、LoRA、节点和输出条款独立，不能只看 ComfyUI 许可。",
  },
  {
    id: "invoke",
    name: "Invoke",
    summary: "面向制作流程的分层画布、局部重绘、节点图和批量出图",
    replaces: "Photoshop 生成式填充",
    categories: ["image"],
    color: "#4056a1",
    mark: "I",
    url: "https://invoke.ai/",
    license: "Apache-2.0（程序）",
    licenseTier: "verify",
    licenseNote: "程序许可宽松，但载入的模型权重仍需逐项审查。",
  },
  {
    id: "flux1-schnell",
    name: "FLUX.1 Schnell",
    summary: "明确允许商业使用的概念图、背景、CG 草稿与贴图生成模型",
    replaces: "通用文生图模型",
    categories: ["image", "resource"],
    color: "#2f3338",
    mark: "F1",
    url: "https://huggingface.co/black-forest-labs/FLUX.1-schnell",
    web: true,
    license: "Apache-2.0",
    licenseTier: "clear",
    licenseNote: "Schnell 权重可商用；不要混用标注非商业的 FLUX.1 Dev 系列。",
  },
  {
    id: "kenney",
    name: "Kenney Assets",
    summary: "2D、像素、UI、输入图标和低多边形 3D 游戏素材库",
    replaces: "通用原型素材包",
    categories: ["resource", "pixel", "3d"],
    color: "#5c8b58",
    mark: "K",
    url: "https://kenney.nl/assets",
    web: true,
    license: "CC0",
    licenseTier: "clear",
    licenseNote: "资产页素材可商用且无需署名；不要使用 Kenney 商标图形。",
  },
  {
    id: "polyhaven",
    name: "Poly Haven",
    summary: "高质量 HDRI、PBR 材质和实拍 3D 模型",
    replaces: "商业 HDRI / 材质库",
    categories: ["resource", "3d"],
    color: "#456f68",
    mark: "P",
    url: "https://polyhaven.com/",
    web: true,
    license: "CC0",
    licenseTier: "clear",
    licenseNote: "可用于商业项目且无需署名。",
  },
  {
    id: "ambientcg",
    name: "ambientCG",
    summary: "PBR 材质、贴花、HDRI 和 3D 物件，适合环境快速搭建",
    replaces: "商业材质订阅",
    categories: ["resource", "3d"],
    color: "#756951",
    mark: "a",
    url: "https://ambientcg.com/",
    web: true,
    license: "CC0",
    licenseTier: "clear",
    licenseNote: "下载资产可复制、修改并用于商业游戏。",
  },
  {
    id: "opengameart",
    name: "OpenGameArt",
    summary: "2D、3D、音乐和音效聚合库，可按许可证筛选",
    replaces: "综合游戏素材市场",
    categories: ["resource", "pixel", "3d", "audio"],
    color: "#8a5b45",
    mark: "O",
    url: "https://opengameart.org/",
    web: true,
    license: "逐件不同",
    licenseTier: "verify",
    licenseNote: "优先选 CC0；CC-BY 要署名，CC-BY-SA/GPL 需评估衍生与分发义务。",
  },
  {
    id: "freesound",
    name: "Freesound",
    summary: "环境声、UI 音效、拟音和氛围录音素材库",
    replaces: "商业音效库",
    categories: ["resource", "audio"],
    color: "#db642d",
    mark: "F",
    url: "https://freesound.org/",
    web: true,
    license: "CC0 / CC-BY / CC-BY-NC",
    licenseTier: "verify",
    licenseNote: "商业游戏只默认采用 CC0 或完成 CC-BY 署名；排除 BY-NC。",
  },
  {
    id: "quaternius",
    name: "Quaternius",
    summary: "风格统一的低多边形角色、建筑、道具与动画包",
    replaces: "低多边形 3D 资产市场",
    categories: ["resource", "3d"],
    color: "#dc4b39",
    mark: "Q",
    url: "https://quaternius.com/",
    web: true,
    license: "QAL 1.0 / 旧包可能为 CC0",
    licenseTier: "verify",
    licenseNote: "2026 年新许可允许商业项目但禁止把原始资产作为素材转售或再分发。",
  },
  {
    id: "google-fonts",
    name: "Google Fonts",
    summary: "中文与拉丁开源字体，适合 UI、标题和宣传图排版",
    replaces: "商业字体库",
    categories: ["resource", "design"],
    color: "#3974d6",
    mark: "G",
    url: "https://fonts.google.com/",
    web: true,
    license: "OFL / Apache / Ubuntu Font License",
    licenseTier: "clear",
    licenseNote: "可商用；随包分发时保留对应字体许可文件。",
  },
  {
    id: "game-icons",
    name: "Game-icons.net",
    summary: "技能、装备、资源和战斗状态 SVG 图标库",
    replaces: "通用游戏图标包",
    categories: ["resource", "design"],
    color: "#4b5159",
    mark: "G",
    url: "https://game-icons.net/",
    web: true,
    license: "多数 CC-BY 3.0，部分 Public Domain",
    licenseTier: "verify",
    licenseNote: "在游戏内鸣谢页记录作者与来源。",
  },
  {
    id: "triposr",
    name: "TripoSR",
    summary: "从单张概念图快速生成可进入 Blender 清理的 3D 网格",
    replaces: "基础物件手工起模",
    categories: ["3d"],
    color: "#7b65bb",
    mark: "T",
    url: "https://github.com/VAST-AI-Research/TripoSR",
    web: true,
    license: "MIT",
    licenseTier: "clear",
    licenseNote: "适合道具和背景草模；上线前必须重拓扑、减面和检查纹理。",
  },
  {
    id: "trellis2",
    name: "TRELLIS.2",
    summary: "高质量图生 3D 与 PBR 材质生成，适合高配离线资产制作",
    replaces: "高精度 3D 草模流程",
    categories: ["3d"],
    color: "#485d96",
    mark: "T2",
    url: "https://github.com/microsoft/TRELLIS.2",
    web: true,
    license: "MIT（模型与代码）",
    licenseTier: "clear",
    licenseNote: "硬件门槛高；官方验证环境为 A100/H100，生成物仍需人工审美与拓扑检查。",
  },
  {
    id: "openvoice",
    name: "OpenVoice",
    summary: "中英日韩等多语种音色迁移与可控语气配音",
    replaces: "临时角色配音与样片",
    categories: ["voice"],
    color: "#5d73c8",
    mark: "O",
    url: "https://github.com/myshell-ai/OpenVoice",
    web: true,
    license: "MIT",
    licenseTier: "verify",
    licenseNote: "V1/V2 可商用；只能使用自有或获得明确授权的参考声音。",
  },
  {
    id: "cosyvoice",
    name: "CosyVoice",
    summary: "中文、多语种、方言与情感可控的本地语音生成",
    replaces: "角色对白样片与旁白",
    categories: ["voice"],
    color: "#3e8b83",
    mark: "C",
    url: "https://github.com/FunAudioLLM/CosyVoice",
    web: true,
    license: "Apache-2.0（仓库）",
    licenseTier: "verify",
    licenseNote: "下载具体权重时再次核对模型卡；禁止未授权克隆真人声音。",
  },
  {
    id: "gpt-sovits",
    name: "GPT-SoVITS",
    summary: "少样本中文角色配音、音色微调和批量台词生成",
    replaces: "角色语音原型制作",
    categories: ["voice"],
    color: "#71609b",
    mark: "G",
    url: "https://github.com/RVC-Boss/GPT-SoVITS",
    web: true,
    license: "MIT（代码）",
    licenseTier: "verify",
    licenseNote: "预训练权重和依赖模型需单独核对；参考音频必须有声音权授权。",
  },
  {
    id: "voicestudio",
    name: "VoiceStudio",
    summary: "本地角色音色设计、克隆、批量配音、转写与视频配音工作台",
    replaces: "分散的角色语音制作与批量导出流程",
    categories: ["voice", "audio"],
    color: "#2f766f",
    mark: "VS",
    url: "https://github.com/debpalash/VoiceStudio",
    web: true,
    license: "AGPL-3.0（应用本体）",
    licenseTier: "verify",
    licenseNote: "适合作为本地制作工具，不直接嵌入游戏；各 TTS 引擎、模型权重和参考声音仍需分别核对授权。",
  },
  {
    id: "gltf-transform",
    name: "glTF Transform",
    summary: "批量检查、整理、合并、减面和压缩 glTF/GLB 资产",
    replaces: "手工 3D 包体优化",
    categories: ["3d"],
    color: "#6a875a",
    mark: "gT",
    url: "https://gltf-transform.dev/",
    web: true,
    license: "MIT",
    licenseTier: "clear",
    licenseNote: "适合建立五款游戏共用的可复现 3D 导出流水线。",
  },
  {
    id: "meshoptimizer",
    name: "meshoptimizer / gltfpack",
    summary: "降低网格复杂度、Draw Call、动画和传输体积",
    replaces: "手工移动端减面",
    categories: ["3d"],
    color: "#59866f",
    mark: "m",
    url: "https://meshoptimizer.org/gltf/",
    web: true,
    license: "MIT",
    licenseTier: "clear",
    licenseNote: "适合 H5 移动端；压缩扩展需确认 Three.js/运行时解码支持。",
  },
  {
    id: "ktx-software",
    name: "KTX-Software",
    summary: "把 3D 贴图转为 KTX2/Basis Universal，降低移动端显存和下载体积",
    replaces: "手工纹理格式转换",
    categories: ["3d"],
    color: "#4d6c8c",
    mark: "K2",
    url: "https://github.com/KhronosGroup/KTX-Software",
    web: true,
    license: "Apache-2.0 为主，逐文件声明",
    licenseTier: "verify",
    licenseNote: "使用官方工具并保留第三方声明；游戏运行时必须支持 KTX2 解码。",
  },
  {
    id: "musicgen",
    name: "MusicGen",
    summary: "文本或旋律引导的音乐生成，仅适合内部概念与节奏参考",
    replaces: "BGM 情绪草稿",
    categories: ["audio"],
    color: "#795b79",
    mark: "M",
    url: "https://github.com/facebookresearch/audiocraft",
    web: true,
    license: "MIT 代码 / CC-BY-NC 4.0 权重",
    licenseTier: "restricted",
    licenseNote: "默认权重禁止商业用途，不应直接用于五款发布游戏。",
  },
  {
    id: "stirling-pdf",
    name: "Stirling PDF",
    summary: "合并、拆分、OCR 与批量 PDF 处理",
    replaces: "Acrobat Pro",
    categories: ["document"],
    color: "#b34e3d",
    mark: "S",
    url: "https://www.stirlingpdf.com/",
    web: true,
  },
];

const workflows = [
  {
    icon: "ShieldCheck",
    title: "移动游戏发布验收",
    description: "布局矩阵、Android 宿主、物理设备分层留证",
    steps: ["浏览器矩阵", "Android Emulator", "TapTap 宿主", "云端 / 本地真机"],
    note: "逐项记录测试范围；模拟器通过不等于物理性能或真实广告库存通过",
  },
  {
    icon: "Gamepad2",
    title: "塔防与经营 3D",
    description: "统一建模、材质与移动端压缩",
    steps: ["Blender", "Poly Haven", "glTF Transform", "gltfpack"],
    note: "GLB + WebP/KTX2，先定面数预算",
  },
  {
    icon: "Mic2",
    title: "乙游角色演出",
    description: "立绘、配音、口型与 CG 视频",
    steps: ["Krita", "OpenVoice", "Rhubarb", "Kdenlive"],
    note: "参考声音必须留存授权证据",
  },
  {
    icon: "BookOpen",
    title: "分支剧情与文案",
    description: "编写、试玩、导出与术语一致性检查",
    steps: ["Inky", "inkjs", "Vale", "JSON"],
    note: "剧情源文件与程序状态分离",
  },
  {
    icon: "PackageOpen",
    title: "像素风新项目",
    description: "像素原画、动画与通用素材",
    steps: ["Pixelorama", "Kenney", "Godot"],
    note: "使用统一调色板与整数倍缩放",
  },
  {
    icon: "Camera",
    title: "摄影精修",
    description: "RAW 调色到像素级修饰",
    steps: ["darktable", "GIMP"],
    note: "建议以 16-bit TIFF 交接",
  },
  {
    icon: "Clapperboard",
    title: "视频成片",
    description: "三维素材、剪辑与声音整理",
    steps: ["Blender", "Kdenlive", "Audacity"],
    note: "使用 FFmpeg 兼容格式",
  },
  {
    icon: "PenTool",
    title: "品牌物料",
    description: "矢量设计到印刷排版",
    steps: ["Inkscape", "Scribus"],
    note: "交付 PDF/X 与 SVG",
  },
  {
    icon: "ScanText",
    title: "文档整理",
    description: "扫描件识别、整理与发布",
    steps: ["OCRmyPDF", "Stirling PDF"],
    note: "处理前保留原始文件",
  },
];

const categories: Array<{ id: "all" | Category; label: string; icon: string }> =
  [
    { id: "all", label: "全部工具", icon: "LayoutGrid" },
    { id: "image", label: "图像摄影", icon: "Image" },
    { id: "pixel", label: "像素动画", icon: "Gamepad2" },
    { id: "3d", label: "3D 建模", icon: "Box" },
    { id: "design", label: "设计排版", icon: "PenTool" },
    { id: "video", label: "视频特效", icon: "Clapperboard" },
    { id: "audio", label: "音频制作", icon: "AudioLines" },
    { id: "voice", label: "角色配音", icon: "Mic2" },
    { id: "writing", label: "剧情文案", icon: "BookOpen" },
    { id: "resource", label: "开放资源", icon: "PackageOpen" },
    { id: "document", label: "文档 PDF", icon: "Files" },
    { id: "testing", label: "设备测试", icon: "ShieldCheck" },
  ];

let activeCategory: "all" | Category = "all";
let query = "";
let statuses = new Map<string, boolean>();
const isDesktop = "__TAURI_INTERNALS__" in window;
const $ = <T extends Element>(selector: string) =>
  document.querySelector<T>(selector);
const lucideIcons = {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Blocks,
  BookOpen,
  Box,
  Camera,
  CircleAlert,
  CircleCheck,
  Clapperboard,
  Download,
  ExternalLink,
  Files,
  Gamepad2,
  GitFork,
  Image: ImageIcon,
  Info,
  LayoutGrid,
  Mic2,
  PackageOpen,
  PenTool,
  Play,
  RefreshCw,
  Route,
  ScanText,
  Search,
  SearchX,
  ShieldCheck,
};
const renderIcons = () =>
  createIcons({ icons: lucideIcons, attrs: { "stroke-width": 1.8 } });

function renderSidebar() {
  const navigation = $("#category-nav");
  if (!navigation) return;
  navigation.innerHTML = categories
    .map(
      (category) =>
        `<button class="nav-item ${activeCategory === category.id ? "active" : ""}" data-category="${category.id}" aria-label="${category.label}" aria-pressed="${activeCategory === category.id}"><i data-lucide="${category.icon}"></i><span>${category.label}</span></button>`,
    )
    .join("");
  navigation
    .querySelectorAll<HTMLButtonElement>("[data-category]")
    .forEach((button) =>
      button.addEventListener("click", () => {
        activeCategory = button.dataset.category as typeof activeCategory;
        renderSidebar();
        renderTools();
      }),
    );
  renderIcons();
}

function matchingTools() {
  const normalized = query.trim().toLowerCase();
  return tools.filter(
    (tool) =>
      (activeCategory === "all" || tool.categories.includes(activeCategory)) &&
      (!normalized ||
        `${tool.name} ${tool.summary} ${tool.replaces} ${tool.license ?? ""} ${tool.licenseNote ?? ""}`
          .toLowerCase()
          .includes(normalized)),
  );
}

function renderTools() {
  const grid = $("#tool-grid");
  const count = $("#result-count");
  if (!grid || !count) return;
  const results = matchingTools();
  count.textContent = `${results.length} 个工具`;
  grid.innerHTML = results.length
    ? results
        .map((tool) => {
          const installed = statuses.get(tool.id) ?? false;
          const available = tool.web || installed;
          const statusText = tool.web
            ? "在线资源"
            : installed
              ? "已安装"
              : "未安装";
          const licenseTier = tool.licenseTier ?? "verify";
          return `<article class="tool-card"><div class="tool-card-head"><div class="tool-mark" style="--tool-color:${tool.color}">${tool.mark}</div><span class="status ${available ? "ready" : "missing"}"><span></span>${statusText}</span></div><div class="tool-copy"><h3>${tool.name}</h3><p>${tool.summary}</p></div><div class="tool-meta"><p><span>定位</span>${tool.replaces}</p>${tool.license ? `<p><span>许可</span><b class="license ${licenseTier}" title="${tool.licenseNote ?? ""}">${tool.license}</b></p>` : ""}</div><button class="tool-action ${available ? "primary" : "secondary"}" data-tool="${tool.id}" data-action="${available ? "launch" : "download"}"><i data-lucide="${tool.web ? "ExternalLink" : installed ? "Play" : "Download"}"></i>${tool.web ? "打开资源" : installed ? "启动" : "获取"}</button></article>`;
        })
        .join("")
    : `<div class="empty-state"><i data-lucide="SearchX"></i><h3>没有匹配的工具</h3><p>换个关键词或分类试试。</p></div>`;
  grid
    .querySelectorAll<HTMLButtonElement>("[data-tool]")
    .forEach((button) =>
      button.addEventListener("click", () => handleToolAction(button)),
    );
  renderIcons();
}

function renderWorkflows() {
  const list = $("#workflow-list");
  if (!list) return;
  list.innerHTML = workflows
    .map(
      (workflow) =>
        `<article class="workflow-row"><div class="workflow-icon"><i data-lucide="${workflow.icon}"></i></div><div class="workflow-copy"><h3>${workflow.title}</h3><p>${workflow.description}</p></div><div class="workflow-steps">${workflow.steps.map((step, index) => `${index ? '<i data-lucide="ArrowRight"></i>' : ""}<span>${step}</span>`).join("")}</div><div class="workflow-note">${workflow.note}</div></article>`,
    )
    .join("");
  renderIcons();
}

async function handleToolAction(button: HTMLButtonElement) {
  const tool = tools.find((item) => item.id === button.dataset.tool);
  if (!tool) return;
  try {
    if (tool.web || button.dataset.action === "download") {
      if (isDesktop) await openUrl(tool.url);
      else window.open(tool.url, "_blank", "noopener,noreferrer");
      showToast(`正在打开 ${tool.name}`, "ExternalLink");
      return;
    }
    if (!isDesktop) {
      showToast("浏览器预览无法启动桌面应用", "Info");
      return;
    }
    await invoke("launch_app", { id: tool.id });
    showToast(`${tool.name} 已启动`, "CircleCheck");
  } catch (error) {
    showToast(
      typeof error === "string" ? error : `无法启动 ${tool.name}`,
      "CircleAlert",
    );
  }
}

async function scanApps() {
  const scanButton = $("#scan-button") as HTMLButtonElement | null;
  scanButton?.classList.add("spinning");
  try {
    if (isDesktop) {
      const result = await invoke<ToolStatus[]>("detect_apps");
      statuses = new Map(result.map((status) => [status.id, status.installed]));
    } else
      statuses = new Map([
        ["gimp", true],
        ["krita", true],
        ["inkscape", true],
        ["blender", true],
        ["audacity", true],
      ]);
    const installed = [...statuses.values()].filter(Boolean).length;
    $("#installed-count")!.textContent = String(installed);
    $("#environment-label")!.textContent = isDesktop
      ? `${installed} 个桌面工具就绪`
      : "浏览器预览模式";
    renderTools();
  } catch {
    showToast("扫描失败，请稍后重试", "CircleAlert");
  } finally {
    window.setTimeout(() => scanButton?.classList.remove("spinning"), 400);
  }
}

function showToast(message: string, icon: string) {
  const toast = $("#toast");
  if (!toast) return;
  toast.innerHTML = `<i data-lucide="${icon}"></i><span>${message}</span>`;
  toast.classList.add("visible");
  renderIcons();
  window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function setupEvents() {
  $("#search-input")?.addEventListener("input", (event) => {
    query = (event.target as HTMLInputElement).value;
    renderTools();
  });
  $("#scan-button")?.addEventListener("click", scanApps);
  $("#workflow-link")?.addEventListener("click", () =>
    $("#workflows")?.scrollIntoView({ behavior: "smooth" }),
  );
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $<HTMLInputElement>("#search-input")?.focus();
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  renderSidebar();
  renderWorkflows();
  setupEvents();
  scanApps();
});
