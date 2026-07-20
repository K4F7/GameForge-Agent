# 实验结果

日期：2026-07-18

## 实现结果

新增独立 `watchRun` 控制器。每轮先调用严格 Schema 的 `replayEvents(after=cursor)`，依序交付新事件，再建立 SSE。`onEvent` 成功后才推进 cursor；新进展会重置重试预算。网络、非终态 EOF、sequence gap、HTTP 429/5xx 使用 500/1000/2000/4000/8000 ms 退避；409/410 和协议错误直接失败。终态事件关闭 reader 并返回。

SSE 层新增结构化 `RunStreamError`，区分 network/http/protocol/gap/eof，所有退出路径取消并释放 reader。TTY 在原屏幕显示恢复状态；`--json` 的事件保持 stdout JSONL，恢复进度进入 stderr。

## 自动化测试

- 首次 stream EOF 后，从 cursor 1 回放 sequence 2 终态，无重复；
- 实时 sequence 2 终态只输出一次，不再 replay；
- 两次注入退避后预算耗尽，第三次请求失败并报告 cursor；
- HTTP 410 不调用 sleep；
- TUI workspace 6 个测试文件、16 项测试通过；额外用 Bun 内置 runner 直接执行 stream/watch 两个文件，7 passed、0 failed。

## 真实 Relay 重启

使用 Node 生产 Relay、隔离端口 `18789` 和忽略目录中的绝对 state file：

1. TUI 提交 `tui-recovery-20260718-b`，stdout 得到 `run.started` sequence 1；
2. 同一 `watch --json` 进程回放 sequence 1 后保持 SSE；
3. 只停止本实验 Relay PID，并立即使用同一 state file 重启；
4. watcher 报告一次“500ms 后第 1 次恢复（游标 1）”；
5. 另一 TUI 显式 `stop`，Relay 生成 `run.stopped` sequence 2；
6. 原 watcher 输出 sequence 2 并以 exit code 0 结束。

第一次编排尝试让 Relay 离线过久，watcher按设计完成五次有限退避并以非零退出；它被保留为失败边界，没有写成通过。第二次缩短重启窗口后取得上述成功证据。聚合工具显示 stdout/stderr 时可能重排两条流，但单独通道契约由代码和测试保证。

## 边界

- Relay 事件保留窗口已截断时返回 410，TUI 不伪造缺失历史；
- 重试控制器不是 Agent 循环，不调用模型、MCP、claim、complete 或 stop；
- `stop` 仍是本实验中另一个显式用户命令；watcher自身不会改变 Run。

## 最终门禁

```text
bun install --frozen-lockfile
bun run check
bun run test                 # 236 tests passed
bun run build
bun run bundle:check
bun run doctor
bun run doctor:browser
bun run doctor:desktop
bun run audit                # 0 vulnerabilities
git diff --check
```

全部命令在最终工作树实际通过；Phaser 异步块仍有 Vite 通用大 chunk 提示，但版本化 bundle 预算无超限。
