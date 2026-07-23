# CodeArts Adapter

`bun run codearts` 使用临时 OpenCode-compatible 配置启动 CodeArts TUI。它只注入 GameForge MCP 的项目输出根和 Relay URL，不替代 CodeArts 的规划、模型或 OAuth。启动器将工作目录固定为仓库根；MCP 对象不使用 CodeArts 26.6.2 会拒绝的非标准 `cwd` 字段。

启动器还显式设置 CodeArts 专用的 `KERNEL_DATA_DIR` 与 `KERNEL_CONFIG_DIR`。不要用同一个数据目录直接交替运行 CodeArts 26.6.x 和独立 OpenCode 1.18.x：两者数据库迁移链不同，可能重复创建或修改表。独立 OpenCode 继续使用自己的默认数据目录；CodeArts 私有目录与认证均不提交仓库。

Relay 可用时，CodeArts 可以经 `ask` 直接调用 `create_game_task` 创建 queued Task 与对应 Run，再以 `agentId: "codearts"` 认领；这条链路不依赖 GUI。相同创建请求按 run ID 幂等，参数冲突必须停下，不得自动轮换 ID。
