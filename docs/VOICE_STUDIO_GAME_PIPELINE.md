# VoiceStudio 游戏配音流水线

VoiceStudio 作为本地制作工具使用，不嵌入游戏客户端。默认服务地址为 `http://127.0.0.1:3900`，MCP 地址为 `http://127.0.0.1:3900/mcp/`。

## 当前状态

2026-10-13 检查时本机 3900 端口未启动，因此本轮没有伪造 VoiceStudio 生成结果。零点回声现有八条原型语音继续保留；正式角色语音应在 VoiceStudio 启动、音色授权确认和角色档案建立后批量重制。

## 五款游戏分工

| 游戏 | 首批语音 | 输出目录 |
| --- | --- | --- |
| 雾港夜市 | 开摊、稀客到访、连击五次、收摊 | `public/audio/voice/` |
| 星契回廊 | 角色登场、技能释放、Boss 警报、章节结算 | `public/audio/voice/` |
| 零点回声 | 三位角色序章/羁绊、系统目标、真相揭示 | `public/audio/voice/` |
| 叠塔守卫 | 开波、首领预警、城堡危急、胜利 | `public/audio/voice/` |
| 山海异兽急诊录 | 异兽入诊、诊断反馈、完美救治、旧阵线索 | `public/audio/voice/` |

## 操作顺序

1. 在 VoiceStudio 中创建或设计经过授权的角色音色，保存稳定的 `profile_id`。
2. 在每个游戏的台词清单中记录角色、情绪、文本、语言、音色档案和目标文件名。
3. 使用 VoiceStudio 的 MCP `generate_speech` 工具批量生成 WAV/OGG；建议配置 `OMNIVOICE_MCP_OUTPUT_MODE=files` 与受限 `OMNIVOICE_MCP_BASE_PATH`。
4. 统一响度、去除首尾静音并输出 OGG/MP3，保留 WAV 母版和生成记录。
5. 在手机 WebView 验证首次播放权限、静音、打断、重复播放和文件缺失降级。

## 授权底线

- 只使用自有、演员书面授权或明确允许商业使用的音色。
- VoiceStudio 本体采用 AGPL-3.0；模型、引擎与权重许可证分别记录。
- 不克隆公众人物、声优或玩家声音，不把参考音频打进游戏包。
- 每条正式语音都记录 `profile_id`、引擎、模型版本、生成日期与人工后期步骤。

## 健康检查

```bash
npm run voice:check
```

VoiceStudio 启动后，也可在 Codex MCP 配置中加入：

```toml
[mcp_servers.voicestudio]
url = "http://127.0.0.1:3900/mcp/"
http_headers = { "X-OmniVoice-Client-Id" = "codex-cli" }
```
