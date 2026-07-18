# 共享 Run 恢复控制器结果

## 实现

- 新增 `@gameforge/run-relay/recovery`，统一连续游标、重复事件忽略、回放分页、终态、有限退避、失败和中止；
- TUI `watchRun` 使用共享控制器，保留 HTTP 429/5xx、network、timeout、gap 和 EOF 的可重试分类；
- Workbench 使用相同控制器，保留 EventSource 传输、409/410 快速失败、手工 reconnect 和 UI 状态；
- 只有事件实际被消费并推进 sequence 后才清零重试次数。仅连接 open 不清零，关闭了“反复 open 后立刻 EOF 导致无限重连”的窗口；
- 控制器只执行 Relay replay/SSE，不认领或完成 Task，不调用 MCP、模型或 Provider。

## 故障注入

- sequence 1 后流收到 sequence 3：从 cursor 1 回放 2、3，交付序列为 1/2/3，无重复；
- 流每次 open 后立即 EOF：两次退避后第三次失败，证明重试预算有界；
- replay 游标被调用方判定致命：不建立 stream、不调度重试；
- 退避期间 AbortSignal 中止：返回 aborted，不继续请求；
- 手工 reconnect 后，已关闭的旧 EventSource 即使迟到发出终态也不会投递、推进游标或覆盖新 generation；
- 每次失败只调用一次重试分类器，耗尽分支不会因重复分类产生副作用；
- 既有 Workbench gap/410/退避测试和 TUI EOF/HTTP 分类测试继续通过。

## 定向验证

```text
bun run --filter @gameforge/run-relay check
bun run --filter @gameforge/run-relay test       # 34 passed
bun run --filter @gameforge/tui check
bun run --filter @gameforge/tui test             # 16 passed
bun run --filter @gameforge/workbench check
bun run --filter @gameforge/workbench test       # 39 passed
```

## 真实 Relay 冒烟

启动 production Relay，创建 `shared-recovery-smoke` Task 后运行真实 `bun run tui -- watch shared-recovery-smoke --json`。TUI 先回放 sequence 1 `run.started`，随后通过 SSE 收到显式 stop 产生的 sequence 2 `run.stopped`，自动以退出码 0 结束；两行 JSON 顺序连续且没有重复。实验结束后停止本轮 Relay，8787 无残留监听。

## 整仓门禁

- `bun install --frozen-lockfile`：通过，锁文件一致且无需下载新外部包；
- `bun run check`：通过；
- `bun run test`：通过，286 项测试；
- `bun run build`：通过；Phaser 异步 chunk 保留既有 `>500 kB` 非失败警告；
- `bun run bundle:check`：通过；
- `bun run doctor`、`bun run doctor:browser`、`bun run doctor:desktop`：通过；
- `bun audit --prod --registry https://registry.npmjs.org`：通过，0 个已知漏洞；
- `git diff --check`：通过。
