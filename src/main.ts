import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Blocks,
  Camera,
  CircleAlert,
  CircleCheck,
  Clapperboard,
  createIcons,
  Download,
  ExternalLink,
  Files,
  GitFork,
  Image as ImageIcon,
  Info,
  LayoutGrid,
  PenTool,
  Play,
  RefreshCw,
  Route,
  ScanText,
  Search,
  SearchX,
  ShieldCheck,
} from "lucide";

type Category = "image" | "design" | "video" | "audio" | "document";
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
};
type ToolStatus = { id: string; installed: boolean };

const tools: Tool[] = [
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
    summary: "三维创作、跟踪、合成与动态图形",
    replaces: "After Effects",
    categories: ["video", "design"],
    color: "#e56b2f",
    mark: "B",
    url: "https://www.blender.org/download/",
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
    { id: "design", label: "设计排版", icon: "PenTool" },
    { id: "video", label: "视频特效", icon: "Clapperboard" },
    { id: "audio", label: "音频制作", icon: "AudioLines" },
    { id: "document", label: "文档 PDF", icon: "Files" },
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
  Camera,
  CircleAlert,
  CircleCheck,
  Clapperboard,
  Download,
  ExternalLink,
  Files,
  GitFork,
  Image: ImageIcon,
  Info,
  LayoutGrid,
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
        `<button class="nav-item ${activeCategory === category.id ? "active" : ""}" data-category="${category.id}"><i data-lucide="${category.icon}"></i><span>${category.label}</span></button>`,
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
        `${tool.name} ${tool.summary} ${tool.replaces}`
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
            ? "在线工具"
            : installed
              ? "已安装"
              : "未安装";
          return `<article class="tool-card"><div class="tool-card-head"><div class="tool-mark" style="--tool-color:${tool.color}">${tool.mark}</div><span class="status ${available ? "ready" : "missing"}"><span></span>${statusText}</span></div><div class="tool-copy"><h3>${tool.name}</h3><p>${tool.summary}</p></div><div class="tool-meta"><span>替代</span>${tool.replaces}</div><button class="tool-action ${available ? "primary" : "secondary"}" data-tool="${tool.id}" data-action="${available ? "launch" : "download"}"><i data-lucide="${tool.web ? "ExternalLink" : installed ? "Play" : "Download"}"></i>${tool.web ? "打开网页" : installed ? "启动" : "获取"}</button></article>`;
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
