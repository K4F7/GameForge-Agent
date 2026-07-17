# GameForge Bun TUI

更新日期：2026-07-18

`apps/tui` 是 Run Relay 的终端客户端。它不理解需求、不调用模型、不认领 Task，也不执行 Agent 循环；CodeArts 仍是主智能体。

启动 Relay 后运行：

```powershell
bun run tui -- list
bun run tui -- submit --run-id my-run --prompt "Create a complete browser safety game." --language en-US
bun run tui -- task task-00000000-0000-0000-0000-000000000000
bun run tui -- run my-run
bun run tui -- watch my-run
bun run tui -- stop my-run
```

默认连接 `http://127.0.0.1:8787/`。可以设置 `GAMEFORGE_RUN_RELAY_URL`，或对任意命令传入 `--base-url`。远程地址必须使用 HTTPS；HTTP 只允许 localhost、127.0.0.1 或 `[::1]`，URL 不得包含凭据、query 或 fragment。

## 输出模式

普通模式输出适合人阅读的任务表或 Run 摘要。`watch` 在 TTY 中刷新同一屏，显示：

- Run 状态与最新 sequence；
- GameSpec 标题与 locale；
- 资产数量与预览 URL；
- 浏览器 verification 的胜负、分数和生命；
- 阶段状态与最近 8 条日志。

传入 `--json` 后输出逐行 JSON，不写 ANSI 控制字符。`watch --json` 先回放历史事件，再通过 SSE 输出实时事件；收到 `run.completed`、`run.stopped` 或不可修复的 `phase.failed` 后自动退出。重复 sequence 被忽略，序列缺口会作为错误退出，不静默跳过。

## 安全和职责边界

- 参数先经过 CLI 边界校验，协议数据继续由 contracts Schema 和 `RunRelayClient` 验证；
- Relay 请求带超时并区分 timeout、network、HTTP 和 protocol 错误；
- TUI 不读取媒体文件、密钥、CodeArts 会话或浏览器截图；
- `stop` 是显式用户命令；TUI 不自动停止或完成 Run；
- TUI 不提供 claim/complete 命令，避免终端界面冒充 CodeArts 执行者。
