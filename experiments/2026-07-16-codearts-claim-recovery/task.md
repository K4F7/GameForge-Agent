# CodeArts 已认领任务恢复实验

## 目标

避免 CodeArts IDE/CLI 或 MCP 客户端重启后只查看 queued 任务，从而把已经由 `codearts` 认领但尚未结束的 Task 永久遗留。

## 验收条件

1. 一次无 status 过滤的任务快照同时可见 claimed 与 queued；
2. 优先恢复 `claimedBy: "codearts"` 的相关 Task；
3. 同一 agent 幂等重新认领；
4. 回放已有结构化事件和权威游标；
5. 已完成阶段不重复执行；
6. 新 MCP Client 可以继续并完成 Run；
7. 不轮询、不在 MCP 内实现 Agent 循环。
