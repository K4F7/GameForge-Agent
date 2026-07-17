# Bun TUI MVP 结果

## 实现

- `RunRelayClient` 新增 `createTask`，统一验证请求、Task 和权威 `run.started`；
- 新增 `apps/tui` 的参数解析、Run 摘要、SSE parser 和命令入口；
- 命令：`submit`、`list`、`task`、`run`、`stop`、`watch`；
- TTY 使用单屏刷新，非 TTY 普通输出不清屏，`--json` 输出逐行事件；
- SSE 忽略重复项、拒绝跨 Run 和 sequence gap，在终态取消 reader 并退出。

## 测试

- TUI 4 个测试文件、9 个测试通过；
- 覆盖参数边界、摘要投影、SSE 连续性/URL安全和真实临时 Relay 集成；
- `bun run --filter @gameforge/tui check`：通过；
- `bun run --filter @gameforge/tui build`：通过。

整仓门禁：

- `bun run check`：通过；
- 该阶段首次整仓验证为 184 个测试；后续 Plugin/Integration 加固后的仓库最新总数见对应实验记录；
- `bun run build`：通过，Phaser 主 chunk 仍有已知大于 500 kB 警告；
- `bun install --frozen-lockfile`：172 个安装、240 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过。

## 真实 Relay 证据

真实 CodeArts completed Run：

```text
Run codearts-real-20260718-0145
Status: succeeded  Sequence: 6
Game: Safety Kit Collector  Locale: en-US
Assets: 0  Preview: http://127.0.0.1:5173/
Verification: passed won score=2 lives=3
```

实时 SSE smoke：

- TUI 创建 `tui-sse-20260718-0220` 与 queued Task；
- 后台 `watch --json` 首先收到 sequence 1 `run.started`；
- 另一个 TUI 进程执行 `stop`；
- watcher 实时收到 sequence 2 `run.stopped` 并在 10 秒上限内自行退出；
- stdout 每行均为 JSON，未混入 ANSI。

## 边界

- 当前不是基于 Ink/Blessed 的组件式全屏界面，而是零额外依赖的 Bun 终端 MVP；
- 尚未在 macOS/Linux CI 验证；
- 交互 TTY 的 resize、键盘快捷键和日志滚动留到第二阶段；
- TUI 有意不提供 Task claim 或 Run complete，避免复制 CodeArts 主智能体职责。
