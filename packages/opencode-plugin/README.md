# @gameforge/opencode-plugin

可选的薄 OpenCode 集成层，不是 GameForge 核心。

第一版只提供：

- 会话创建时检查 `gameforge` MCP 与 Relay，并显示 TUI toast；
- `gameforge_status` 只读工具，返回 MCP 状态和 Task 数量；
- session idle 时检测新完成的 Relay Task，并显示通知。

OpenCode 官方 Plugin API 没有稳定的 slash-command 注册 Hook；只有显式加载本插件后，宿主配置才可以把 `/gameforge-status` 映射为“调用 `gameforge_status` 并汇总状态”。根目录的 `opencode.json.example` 仅是可独立使用的 GameForge MCP 模板，不预声明这个依赖插件的命令。插件不会 claim Task、生成项目、发布 RunEvent 或完成 Run。
