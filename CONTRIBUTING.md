# 参与贡献

感谢你改进 Open Creator Toolbox。

## 开始之前

1. 搜索现有 Issue，避免重复工作。
2. 新增工具时优先链接项目官网，并确认项目仍在维护。
3. 不要提交第三方二进制、商标素材、密钥、日志或本地构建产物。

## 开发流程

```bash
npm install
npm run catalog:check
npm run qa:check
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

工具启动必须通过 Rust 中的固定目录表实现，不能把前端输入直接传给 shell。新增工具时请同时考虑 macOS、Windows 和 Linux；无法覆盖的平台应在 PR 中说明。

## 提交说明

- 一个提交聚焦一个主题。
- 清楚描述变更、验证结果和平台限制。
- UI 改动建议附截图。
