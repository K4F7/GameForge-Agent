# GameForge Bun TUI

更新日期：2026-07-18

`apps/tui` 是 Run Relay 的终端客户端。它不理解需求、不调用模型、不认领 Task，也不执行 Agent 循环；CodeArts 仍是主智能体。

启动 Relay 后运行：

```powershell
bun run tui -- list
bun run tui -- submit --run-id my-run --prompt "Create a complete browser safety game." --language en-US
bun run tui -- submit --run-id improve-run --project-id existing-game --prompt "Add a second level and keep existing assets."
bun run tui -- task task-00000000-0000-0000-0000-000000000000
bun run tui -- follow task-00000000-0000-0000-0000-000000000000
bun run tui -- run my-run
bun run tui -- watch my-run
bun run tui -- stop my-run
```

默认连接 `http://127.0.0.1:8787/`。可以设置 `GAMEFORGE_RUN_RELAY_URL`，或对任意命令传入 `--base-url`。远程地址必须使用 HTTPS；HTTP 只允许 localhost、127.0.0.1 或 `[::1]`，URL 不得包含凭据、query 或 fragment。

Relay 启用 Bearer 时，在 TUI 进程环境设置至少 32 字符的 `GAMEFORGE_RUN_RELAY_TOKEN`；普通请求和 `watch` SSE 都会放入 Authorization header，token 不写入 URL 或输出。不要通过命令行参数传 token，以免进入 shell history。

交互式 `watch` 中使用 `↑`/`↓` 或 `k`/`j` 逐行滚动，`PageUp`/`PageDown` 翻动五行，`q` 或 `Ctrl-C` 退出。终端 resize 会按新的行列数重绘；退出时恢复 raw mode。重定向或 `--json` 模式不启用 ANSI、快捷键或滚动裁剪。

## 输出模式

`follow TASK_ID` 会先读取 Task 得到其 Run ID，再自动进入与 `watch` 相同的历史回放和 SSE 恢复流程；它不认领或修改 Task。普通输出先显示 Task/Run 关联；`--json` 先输出一条 `task.snapshot`，随后输出逐行 RunEvent。

普通模式输出适合人阅读的任务表或 Run 摘要。`watch` 在 TTY 中刷新同一屏，显示：

- Run 状态与最新 sequence；
- GameSpec 标题与 locale；
- 资产数量与预览 URL；
- 抖音或微信 LayaAir 构建 target、版本、方向、文件/包体和媒体 Manifest revision；
- 浏览器 verification 的胜负、分数和生命；
- 阶段状态与最近 8 条日志。

传入 `--json` 后 stdout 只输出逐行事件 JSON，不写 ANSI 控制字符。`watch --json` 先回放历史事件，再通过 SSE 输出实时事件；恢复等待说明只写 stderr，不污染事件管道。收到 `run.completed`、`run.stopped` 或不可修复的 `phase.failed` 后自动退出。重复 sequence 被忽略；序列缺口、非终态 EOF、网络错误、HTTP 429/5xx 会从最后连续游标按 0.5/1/2/4/8 秒有限退避重新回放，缺失事件补齐后再建流。HTTP 409/410、协议错误或预算耗尽会非零退出，不静默跳过或无限重试。回放、连续游标、终态和重试预算由 `@gameforge/run-relay/recovery` 的共享纯 TypeScript 控制器实现，Workbench 与 TUI 只分别适配浏览器 EventSource 和 Bun fetch stream；真正收到新事件后才重置重试预算，单纯 open 后立即断开不会导致无限重连。

## 安全和职责边界

- 参数先经过 CLI 边界校验，协议数据继续由 contracts Schema 和 `RunRelayClient` 验证；
- Relay 请求带超时并区分 timeout、network、HTTP 和 protocol 错误；
- TUI watch 恢复只执行确定性 replay GET 与 SSE，不认领/完成 Task，也不调用模型或 MCP；
- TUI 不读取媒体文件、密钥、CodeArts 会话或浏览器截图；
- `stop` 是显式用户命令；TUI 不自动停止或完成 Run；
- TUI 不提供 claim/complete 命令，避免终端界面冒充 CodeArts 执行者。
