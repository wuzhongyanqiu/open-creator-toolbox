# Open Creator Toolbox

一个轻量、跨平台的开源创作工具启动器。它帮你发现、安装并快速启动 GIMP、Krita、Inkscape、Kdenlive、Blender 等优秀工具，也提供跨软件工作流建议。

> 项目不捆绑第三方软件，也不会上传或分析你的创作文件。应用检测和启动均在本地完成。

## 功能

- 自动检测本机已安装的开源创作应用
- 按图像、设计、视频、音频和文档分类浏览
- 搜索工具、用途或对应的 Adobe 产品
- 一键启动已安装应用，或打开官方下载页面
- 展示使用开放格式连接工具的推荐工作流
- 支持 macOS、Windows 和 Linux

## 当前工具目录

| 领域 | 工具 |
| --- | --- |
| 图像与摄影 | GIMP、Krita、darktable |
| 矢量与排版 | Inkscape、Penpot、Scribus |
| 视频与特效 | Kdenlive、Blender、Natron |
| 音频 | Audacity、Ardour |
| PDF | Stirling PDF |

## 本地开发

项目使用 [Tauri 2](https://v2.tauri.app/) 和原生 TypeScript，系统依赖请参考 [Tauri 前置要求](https://v2.tauri.app/start/prerequisites/)。

```bash
npm install
npm run tauri dev
```

只预览前端界面：

```bash
npm run dev
```

执行验证：

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 隐私与安全

- 工具目录在代码中显式维护，启动接口不接受任意命令。
- 检测只读取常见安装目录与 `PATH`，不扫描个人文件。
- 外部链接只指向工具官网。
- 项目不包含遥测、账号系统或云端服务。

## 参与贡献

欢迎补充应用检测路径、工具资料、翻译和工作流。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

本项目使用 [MIT License](LICENSE)。目录中提到的软件、名称和商标分别属于其项目或权利人，本项目与 Adobe 无隶属或赞助关系。
