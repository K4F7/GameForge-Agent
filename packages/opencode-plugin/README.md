# @gameforge/opencode-plugin

可选的薄 OpenCode 集成层，不是 GameForge 核心。

第一版只提供：

- 会话创建时检查 `gameforge` MCP 与 Relay，并显示 TUI toast；
- `gameforge_status` 只读工具，返回 MCP 状态和 Task 数量；
- session idle 时检测新完成的 Relay Task，并显示通知。

OpenCode 官方 Plugin API 没有稳定的 slash-command 注册 Hook，因此 `/gameforge-status` 由 `opencode.json.example` 的 `command` 配置预声明，再提示模型调用 `gameforge_status`。插件不会 claim Task、生成项目、发布 RunEvent 或完成 Run。
