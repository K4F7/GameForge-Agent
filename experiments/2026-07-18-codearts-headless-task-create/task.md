# 任务

让真实 CodeArts 26.6.2 非交互 CLI 在不打开 Workbench 的情况下，通过 GameForge MCP：

1. 原子创建一个 queued Task 与对应 Run；
2. 以 `agentId: "codearts"` 认领 Task；
3. 从 sequence 0 回放 Run；
4. 证明只有一个权威 `run.started`，且未重复调用 `create_game_run`。

本实验只验收 Task/Run 协调协议，不生成项目、不调用媒体 Provider、不完成或发布 Run。
