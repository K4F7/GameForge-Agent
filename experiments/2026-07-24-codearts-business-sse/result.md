# CodeArts 业务 SSE 与 Observer 恢复验收

日期：2026-07-24

## 目标与边界

- 使用真实 CodeArts Agent 26.6.2 `serve` 和锁定的官方 `@opencode-ai/sdk@1.18.3`，验证 `/global/event` 的业务事件 payload。
- 验证 Observer 受控重连、本地 sequence 连续性、单写者锁和外层强制终止后的恢复。
- 使用隔离的 `KERNEL_DATA_DIR`、`KERNEL_CONFIG_DIR` 与 loopback 固定端口；不与默认 CodeArts/OpenCode 数据库共享状态。
- 不生成游戏、不部署、不上传、不调用外部媒体 Provider。为验证 Message/Part，使用 `promptAsync({ noReply: true })` 写入一条脱敏协议探针文本，不请求 assistant 回复。

原始 Evidence 位于已忽略目录 `.gameforge-validation/2026-07-24-codearts-business-sse/`。原始 CodeArts 日志包含用户域标识和 session 正文，不提交仓库。

## 实际版本与入口

- CodeArts Agent：26.6.2。
- Observer SDK：`@opencode-ai/sdk@1.18.3`。
- CodeArts `--help` 实际列出 `serve` 与 `attach <url>`；这证明当前安装版本支持 headless server 和 attach，结论不依赖 OpenCode 上游推断。
- 服务入口：隔离目录下的 `codearts serve --pure --hostname 127.0.0.1 --port 4097`。

## 业务事件结果

第一条空 Session 通过官方 SDK 创建，Observer 收到：

- `server.connected`；
- `project.updated`，properties 包含 `id/worktree/vcs/sandboxes/time`；
- `session.created`，properties 包含 `sessionID/info`；
- `session.updated`，properties 包含 `sessionID/info`。

断开并重新连接后创建第二条空 Session：

- Evidence sequence 从 1 连续追加到 7；
- 第二次连接新增 `server.connected/session.created/session.updated`；
- 没有重放第一条 Session 的业务事件。

第三条 Session 使用 `promptAsync({ noReply: true })` 写入用户 Message/Part，新增事件：

- `session.created`、`session.updated`；
- `message.updated`，properties 包含 `sessionID/info`；
- `message.part.updated`，properties 包含 `sessionID/part/time`；
- 最终 Evidence sequence 连续到 15。

所有 15 条事件的 `sseId` 均为 `null`。因此已证明 CodeArts 26.6.2 的 Session/Message/Part 业务 payload 可由官方 SDK Observer 读取；仍不能证明 SSE `id:`、`Last-Event-ID` 或基于原生 ID 的服务端重放行为。

## TUI attach 同会话验证

使用与 server 相同的隔离 `KERNEL_DATA_DIR/KERNEL_CONFIG_DIR`，通过真实 ConPTY 执行 `codearts attach <loopback-url> --session <session-id> --pure`：

- TUI 成功恢复第三条 Session，VT 中可见该 Session 已保存的协议探针文本，readiness 通过；
- attach 期间 Observer 收到 `server.connected`、`project.updated` 与 `tui.toast.show`；
- attach 事件的 `sseId` 仍全部为 `null`；
- 退出后 CodeArts server 端口和 Observer 锁均已释放。

一次先行探针直接调用 CodeArts 可执行文件且未注入隔离目录，错误访问了默认 OpenCode 数据库并因 workspace migration 冲突退出。该次属于绕过仓库 launcher 的实验控制错误，不作为 CodeArts attach 产品结论；有效 attach 已在隔离目录下重跑。

## Provider 与人工干预

`noReply: true` 没有产生 assistant Message、工具调用或推理输出，但 CodeArts 仍初始化内置 Provider，并访问认证、模型和会话元数据服务。此次运行不能描述为无外部网络；未观察到 429、rate-limit 或 fallback，也未调用外部媒体 Provider。

人工干预仅包括启动/停止隔离 CodeArts server、执行 SDK 探针和按精确 PID 清理测试进程。端口 4097 与 Observer 锁在结束时均已释放。

## 强制终止与锁恢复

Observer Evidence 锁现记录 `pid/createdAt`。测试覆盖：

- owner PID 存活时拒绝第二写者；
- owner PID 不存在时恢复 stale lock；
- Windows 外层进程异常退出留下真实 PID 锁后，同一路径可重新启动并删除锁；
- PATH 中 `bun` shim PID 可能不同于实际持锁 Bun PID，因此以锁 owner PID 为权威身份。

无法解析、缺少 PID 或无法确认 owner 已死亡的旧锁保持 fail closed，不自动删除。

## 结论与剩余风险

业务事件 schema 已从仅有 server heartbeat 推进到真实 `project/session/message/message.part` 事件，并完成一次无原生 ID 的受控重连。Observer 强制终止后永久锁死的问题已修复。

剩余风险：CodeArts 当前事件没有 SSE `id:`，无法实证 `Last-Event-ID`；`noReply` 仍初始化内置 Provider；虽然 TUI attach 已恢复同一 Session，但尚未把原始事件与同一次 Relay Task/Run、MCP Audit、VT 和浏览器截图全部关联。

## Relay、OpenChamber 与 Harness 联合探针

后续使用真实 Relay、CodeArts 26.6.2 server、OpenChamber 1.16.3 和构建后的 UI Harness `dist/cli.js` 运行同一次 headless attach。三个服务分别绑定 loopback `8787`、`4097`、`43163`，CodeArts 继续使用隔离的 `KERNEL_DATA_DIR/KERNEL_CONFIG_DIR`。OpenChamber `/health` 返回 200 并报告版本 1.16.3。

联合运行已证明：

- Harness 能创建 Relay Task/Run、attach 到指定 CodeArts session、启动 OpenChamber Playwright 驱动并写入 VT、screen、GUI、authority、activity 与最终 result evidence；
- 指令文本出现在真实 CodeArts TUI 输入框，TUI output sequence 从 18 增至 21；
- Controller 在失败后返回结构化 `HarnessResult.failed` 并清理三个测试服务。

但该次运行没有完成业务闭环：

- Relay Task 保持 `queued`，Run 保持 `running`，最后事件为 sequence 1 的 `run.started`；
- CodeArts server 的 session message 列表为空；
- MCP Audit 为空数组；
- 15 秒无新 TUI、Authority 或项目活动后，watchdog 报 `Activity watchdog timed out while waiting for: Task and Run completed`；
- 总运行约 27 秒，未发生部署、上传或媒体 Provider 调用。

这说明 ConPTY attach 可以恢复和显示同一 session，但当前自动化发送的 Enter 没有在真实 CodeArts 26.6.2 attach 中提交输入。将 paste 与 Enter 分开一秒、以及对照发送 CR/LF 后，服务端仍没有创建 user message；尚无足够证据修改公共按键映射。该交互契约仍是完整 Task/Run/MCP 闭环的阻塞点。

后续协议探针进一步定位到 Windows PTY 兼容性：CodeArts 完整渲染时向终端输出 `CSI ?9001h`，启用 Windows Terminal Win32 input mode。`bun-pty@0.4.10` 在不注册 `onData`、即不持续读取 VT 输出时，Escape、bracketed paste 和 CR 可以创建 user message；一旦注册 `onData` 以捕获 Harness 必需的 VT evidence，同一序列不再提交。CRLF、CSI-u、Win32 key record、SGR 鼠标聚焦、标准 Kitty/theme 查询响应及多次 Escape 均未恢复提交。关闭 VT capture 会破坏验收核心证据，因此不能作为修复。

Harness 现在检测真实 VT 中的 Mode 9001，并在 `sendText(..., { appendEnter: true })` 或 `sendKey(...)` 时立即返回明确错误：`CodeArts enabled Win32 input mode, which bun-pty cannot submit while VT output capture is active.`。真实回归在约 5.8 秒内失败，VT 欢迎屏与 sequence 仍可读取，CodeArts server message 数保持 0；相比等待 15 秒 watchdog，失败原因更准确且不会留下半提交文本。完整业务闭环仍需替换或修复 Windows PTY 输入实现，不能声称已经通过。

另一次从 TypeScript 源码直接运行 `src/cli.ts` 的探针在 GUI 启动时失败，因为 Playwright helper 按同目录 `.js` 路径启动，而源码目录只有 `.ts`。仓库正式入口会先构建并运行 `dist/cli.js`，正式入口不受此问题影响；源码直跑不作为支持的验收入口。

## Mode 9001 后续修复与完整闭环

对成熟替代实现的隔离探针使用 OpenChamber 已锁定的 `node-pty@1.2.0-beta.12`（MIT、Windows ConPTY）。持续注册 `onData` 后，它与 `bun-pty` 一样能捕获完整 VT 和 `CSI ?9001h`，但普通 CR、完整 Win32 Enter key record、`/tui/append-prompt` + `/tui/submit-prompt` 均只改变输入框显示，CodeArts server message 列表仍为空。未把 `node-pty` 加入 GameForge 依赖，因为真实探针没有解决提交问题。

锁定的官方 `@opencode-ai/sdk@1.18.3` 提供 `session.promptAsync`。在同一真实 attach session、Mode 9001 开启且 VT 持续采集时，对照探针通过该 API 创建 user message；修改后的正式 `ConPtyCodeArtsDriver.sendText(..., { appendEnter: true })` 在 attach 模式调用这一原生 Session API，非提交粘贴、standalone TUI 与导航键仍保留 PTY 行为。公共 seam 先出现旧 Mode 9001 拒绝错误（red），最小实现后 UI Harness 12 个测试文件、54 个测试、类型检查及 5 项依赖审查通过（green）。真实驱动回归随后同时观察到 user message、assistant message、18 个 VT frame 和 Mode 9001。

修复后使用真实 Relay、CodeArts Agent 26.6.2、OpenChamber 1.16.3 与构建后的 `packages/ui-test-harness/dist/cli.js` 重跑完整 headless 场景。第一次运行已经完成 Task/Run，但暴露出新的审计关联问题：Agent/MCP 循环运行在预先启动的 CodeArts server，attach TUI 进程的 `GAMEFORGE_MCP_AUDIT_DIR` 无法改变 server 环境，因此原始审计落在默认 `.gameforge-validation/integrations/codearts/mcp-audit/`，本轮 session 的聚合 `mcp-audit.json` 为空。默认目录中的原始文件 context 与本轮 task/run 精确匹配，记录 9 次调用，这证明不是审计丢失，而是启动期目录绑定错误。

第二次运行预先固定 Harness sessionId，并在启动 CodeArts server 前把 `GAMEFORGE_MCP_AUDIT_DIR` 指向该 sessionRoot 的 `mcp-audit/`。最终权威证据为：

- Task `task-147a76d5-0b07-47ef-a619-eefbacb57a16` 由 `codearts` 认领并进入 `completed`；Run `ui-harness-1784834508471-9aee473e` 的 sequence 1-6 从 `run.started` 连续到 `run.completed`；
- 原始审计成功聚合为 1 条记录，context 精确绑定该 task/run，共 8 次工具调用；`claim_game_task`、`get_gameforge_capabilities`、`get_game_task`、`bind_mcp_audit_context`、`replay_game_run`、`publish_run_events` 与 `complete_game_run` 成功；`get_project_assets` 因项目未生成返回预期错误，Agent 将该负向只读结果写入 phase/log 事件后正常完成；
- VT evidence 约 405 KB，最终 output sequence 为 3726；OpenChamber 的 `loaded`、`before-interaction`、`after-interaction`、`completed`、`success` 五个阶段均有 PNG，console error、page error 与 failed request 全为空；
- 总运行约 97 秒；没有生成游戏、部署、上传或调用外部媒体 Provider；结束后 8787、4097、43163 均无监听残留。

当前结论：CodeArts Task 认领、官方 Session 提交、确定性 MCP 调用、RunEvent、原始 MCP Audit、原版 TUI VT 与 OpenChamber 浏览器证据已在同一次 run 中闭环通过。仍未解决的是 Windows Mode 9001 下“持续 VT 采集同时模拟物理 Enter”这一底层 PTY 行为；attach 自动化现在明确使用官方 Session API，而不是声称键盘注入已修复。外部 CodeArts server 的原始审计目录仍必须在 server 启动时与预定 Harness sessionId 绑定。

## OpenChamber 外部 Server 与项目状态复核

对上一轮 `success` PNG 进行人工视觉复核后发现，页面虽然无诊断错误，但仍停留在 `Add project directory` 对话框。这说明此前证据只证明 OpenChamber 页面健康，未充分证明 GUI 已连到本轮 CodeArts server 并展示项目/会话状态。

联调编排随后按 OpenChamber 1.16.3 的公开契约修正：启动时设置 `OPENCODE_HOST=http://127.0.0.1:4097` 与 `OPENCODE_SKIP_START=true`，服务就绪后调用 `POST /api/opencode/directory` 登记仓库绝对路径，并通过 `GET /api/config/settings` 断言 `lastDirectory/projects/activeProjectId` 已持久化。第一次修正运行中 Task/Run 与 9 次原始 MCP 调用均完成，左侧栏也已显示真实项目和会话，但浏览器门禁暴露 4 条 console error：OpenChamber 分别重复读取尚未创建的用户项目配置和仓库 `.openchamber/openchamber.json`，服务按预期返回 404；异步目录对话框仍覆盖最终截图。

公共 Playwright driver seam 先用真实浏览器构造两个可选配置 404 和一个普通业务资源 404，旧实现记录 3 条错误（red）。最小实现只在同时满足 `/api/fs/read`、404 文本与上述两个精确路径模式时过滤；普通资源 404 继续保留，55 个 UI Harness 测试通过（green）。场景在 Authority 完成后向 `body` 发送一次 `Escape`，关闭异步目录对话框。

最终重跑约 92 秒并通过：Task `task-cfc76d6e-5a47-4457-92a8-5992bf874ab4` 由 `codearts` 完成，Run `ui-harness-1784836123871-1adfcbea` 到达 `run.completed`；原始审计聚合 1 条记录、7 次调用，其中 `get_project_assets` 因未生成项目返回预期错误，其余调用成功。七个 GUI 阶段的 console/page/failed-request 诊断均为空；人工复核最终 PNG 显示 `GameForge-Agent` 项目、真实 CodeArts 会话条目和 GLM-5.1/Build 状态，目录对话框已关闭。8787、4097、43163 均无监听残留。权威 Evidence 位于忽略目录 `.gameforge-validation/2026-07-24-codearts-sdk-joint-closure-bound-audit/sessions/19013d8d-e990-4e84-b64b-ae25c4229dea/`。
