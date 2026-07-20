# 抖音 DevTool Runtime MCP 端到端验收

## 结果

- 状态：通过
- Run ID：`run-douyin-runtime-e2e-20260720134026293`
- DevTool：抖音开发者工具 4.5.4
- 工程：`.gameforge-validation/gameforge-laya-spike/release/bytedancegame`
- 人工干预：重启 DevTool 一次；点击一次 `GameForge: disconnected`
- 远程操作：禁止；未执行 preview、上传、提审或发布

## MCP 闭环

1. `create_game_run` 创建本地 Run。
2. `get_douyin_devtool_runtime_status` 确认桥接已认证，扩展上报 `runtime-actions`。
3. Runtime 返回 `MiniApp Webview`、`tt`、`GameGlobal` 和 Canvas/viewport 信息。
4. `run_douyin_runtime_action` 在 `(206, 150)` 执行一次有界 `tap`，返回 `ok: true`。
5. 动作通过 Run Relay 写入 `log.appended`。
6. 再次读取 Runtime 状态，仍为 `available: true`。
7. `complete_game_run` 发布终态。

最终连续事件为：

- sequence 1：`run.started`
- sequence 2：`log.appended`
- sequence 3：`run.completed`

机器可读证据见 `evidence.json`。

## 发现与修复

- DevTool 原先加载的是旧扩展构建，只上报 `workspace-status` 和 `runtime-status`，会忽略 Runtime action。
- 已用通过测试的构建更新本地扩展运行文件；重启后上报 `workspace-status`、`runtime-status`、`runtime-actions`。
- MCP bridge 请求总超时由 10 秒调整为 45 秒，以覆盖多个内部 5 秒有界 CDP 阶段；各阶段仍保持独立超时。

## 验证命令

```powershell
bun run --filter @gameforge/mcp-server check
bun run --filter @gameforge/mcp-server test
bun run --filter gameforge-douyin-devtool-extension test
bun run douyin:e2e
```

## 自动重连验收

- 第一轮 Run：`run-douyin-runtime-e2e-20260720141112902`，人工点击一次连接后完整通过。
- 第一轮 controller 正常退出，扩展保留“期望连接”状态并进入退避等待。
- 第二轮 Run：`run-douyin-runtime-e2e-20260720141222960`。
- 第二轮启动了使用新随机端口和新 token 的 controller，未进行任何 GUI 点击。
- 扩展自动读取新的 short-lived rendezvous，完成重新认证、Runtime 状态读取、有界 tap、RunEvent 发布和 `run.completed`。
- 自动重连等待采用 250ms 起步、最大 5 秒的指数退避；手动 Disconnect 会取消后续重连。

## 持久 Host 验收

- 启动 `bun run dev:douyin-bridge` 后，Bridge Host 独立持有 DevTool controller 和认证连接。
- host 只监听随机 loopback 端口，通过 `%TEMP%/gameforge-douyin-bridge-host.json` 中的随机 token 保护本地 HTTP RPC。
- 以 `GAMEFORGE_DOUYIN_BRIDGE_MODE=host` 启动独立 stdio MCP，会话成功读取 Runtime 状态并执行一次有界 tap。
- stdio MCP 会话退出后再次查询 host，DevTool 仍保持 `connected: true`。
- 验证命令：`bun run douyin:host-smoke`。

## 持久 Host 实际测试

- 测试前 Host/DevTool 为 `connected: true`，能力包含 `runtime-actions`。
- 独立 stdio MCP 成功读取 `MiniApp Webview`；`tt`、`GameGlobal`、Canvas 和 393×852 viewport 均可用。
- 首次以 touch CDP 执行 tap 时返回 `Timed out waiting for CDP Input.dispatchTouchEvent.`；连接未中断。该动作不计为通过，也未自动重试，以避免重复输入。
- 修正 smoke 判定：Runtime action 的内部 `ok` 不为 `true` 时命令必须失败，不能只依据 MCP transport 成功。
- 随后使用固定、只读的 `collectConsole(500ms)` 重新测试，返回 `ok: true`、空日志数组。
- stdio MCP 退出后 Host/DevTool 仍为 `connected: true`。
