# CodeArts Adapter

`bun run codearts` 使用临时 OpenCode-compatible 配置启动 CodeArts TUI。它只注入 GameForge MCP 的项目输出根和 Relay URL，不替代 CodeArts 的规划、模型或 OAuth。

启动器还显式设置 CodeArts 专用的 `KERNEL_DATA_DIR` 与 `KERNEL_CONFIG_DIR`。不要用同一个数据目录直接交替运行 CodeArts 26.6.x 和独立 OpenCode 1.18.x：两者数据库迁移链不同，可能重复创建或修改表。独立 OpenCode 继续使用自己的默认数据目录；CodeArts 私有目录与认证均不提交仓库。
