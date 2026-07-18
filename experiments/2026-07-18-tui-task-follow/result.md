# 实验结果

状态：通过。

新增 `gameforge-tui follow TASK_ID [--after N]`。命令先通过 Relay `getTask` 获取权威 Run ID，再复用现有 `watch` 的回放、SSE、连续游标、有限重试和终态退出；不调用 claim、complete、stop、MCP 或模型。

真实 Relay 集成测试创建 Task、由外部测试步骤停止 Run，然后只向 TUI 提供 Task ID。`follow --json` 首行输出 `task.snapshot`，后续历史中包含正确 Run ID 的 `run.stopped`，并在终态自动返回。

验证：

```text
bun run --filter @gameforge/tui check
bun run --filter @gameforge/tui test   # 6 files, 17 tests passed
bun run --filter @gameforge/tui build
```

边界：本实验覆盖真实本地 Relay 协议与终态回放；未重复执行 CodeArts 云模型任务，也不替代 macOS/Linux GitHub runner 证据。
