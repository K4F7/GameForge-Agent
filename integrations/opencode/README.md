# OpenCode Adapter

`bun run opencode` 使用同一套 GameForge MCP/Relay 边界启动 OpenCode。该适配器用于同任务对照实验，不代表 GameForge 核心依赖 OpenCode。

启动器通过 `OPENCODE_CONFIG` 隔离 GameForge MCP 配置，但默认沿用 OpenCode 自己的用户 data。需要一次性隔离会话/数据库时，在启动进程中把标准 `XDG_DATA_HOME` 设置为绝对、被忽略且权限受限的目录；这会同时隔离 `auth.json`，启动器不会复制或输出认证材料。CodeArts 仍使用独立的 `KERNEL_DATA_DIR`，两端不得共享数据库文件。

真实同任务记录见 `experiments/2026-07-18-codearts-opencode-douyin-comparison/`。它验证本地 Task/MCP/玩法/构建边界，不代表 OpenCode 取代 CodeArts 主智能体。
