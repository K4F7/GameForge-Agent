# UI Test Harness

这是 CodeArts 原版 TUI 与 OpenChamber 原版 GUI 的外置测试控制层，不是第三套产品 UI。

当前 MVP 提供真实 ConPTY、官方 xterm.js 同流观察、Playwright OpenChamber 驱动、Relay Authority 和文件证据适配器。导入模块不会启动进程、浏览器或测试会话，只有显式 CLI 才执行验收。

## 固定边界

- `CodeArtsTuiDriver` 只连接真实 CodeArts 会话：唯一 ConPTY 保留原版 TUI、VT 输出与导航输入；attach 模式的任务提交使用锁定的官方 OpenCode SDK Session API，不得以 pipe、数据库写入或伪造会话替代真实客户端与服务端。
- `CodeArtsTuiObserverDriver` 固定使用独立 xterm 窗口渲染上述唯一 ConPTY 的同一 VT 输出；它不创建第二个 CodeArts 会话。
- `OpenChamberGuiDriver` 通过真实浏览器操作原版 OpenChamber 页面；测试框架不得修改 OpenChamber，也不得注入终端面板或测试专用业务 UI。
- 两个被测窗口彼此独立。控制器可以同时观察它们，但 OpenChamber 不承载 CodeArts TUI。
- `GameForgeAuthorityDriver` 单独读取 Task、Run 与 RunEvent；阶段通过只接受该权威状态，不解析模型自然语言。Task 返回的 `runId` 以及显式绑定的 `projectId` 必须与 Harness 配置一致，错配时拒绝生成 Authority 快照；并发快照即使乱序返回，已观察到的事件序号与终态也不得倒退。
- `EvidenceSink` 保存输入、TUI 屏幕、GUI 诊断、权威状态和生命周期；敏感原件只能落到仓库忽略目录。
- `UiTestController` 负责编排、观察保留与综合活动看门狗，不实现 Agent 循环。

## 当前可运行边界

先启动 Relay 与固定版本的原版 OpenChamber。本机验证版本为 OpenChamber `1.16.3`（MIT）。浏览器验收应使用 `bun run build:web` 后的生产服务；HMR 只用于开发，不作为长期诊断门禁依据。随后运行：

```powershell
bun run --filter @gameforge/ui-test-harness run:headless
# 或显式可见的两个独立窗口
bun run --filter @gameforge/ui-test-harness run:headed
```

默认 OpenChamber URL 为 `http://127.0.0.1:43163/`（原版生产构建的固定端口，是唯一经过完整验收的端口；Vite dev 端口不作为验收目标），可用 `--openchamber-url` 或 `GAMEFORGE_OPENCHAMBER_URL` 覆盖，但只接受无凭据 loopback HTTP(S)。该命令使用真实 Bun ConPTY 启动 `bun run codearts`，连接既有 Relay，并将 VT、生命周期、活动样本、Authority 快照、MCP Audit、浏览器诊断和 PNG 截图写入 `.gameforge-validation/`。默认活动超时 120 秒，总门禁 15 分钟；headed 成功后默认保留窗口 10 秒，失败后默认保留 30 秒（`--failure-hold-ms` 可调，上限 300 秒），便于阅读屏幕上的错误后再收窗；headless 不保留。

运行前可执行 `bun run testenv:status` 做预检：它探测 Authority Relay、原版 OpenChamber 生产服务、其生产构建产物与 CodeArts 客户端，对每个不可用项给出该敲的补救命令。它不启动任何进程，通常在一秒内完成。

需要把预先启动的外部 Observer 与 Harness Evidence 关联时，可显式传入 `--session-id <id>`。单次权威执行使用该 ID 关联 Evidence。

attach 到预先启动的 CodeArts server 时，`--codearts-server-url` 与 `--codearts-session` 必须成对提供。CodeArts 26.6.2 在 Windows 完整渲染时启用 Mode 9001；`bun-pty@0.4.10` 在持续读取 VT 证据时无法用 CR 提交，`node-pty@1.2.0-beta.12` 及 Win32 key record 对照也没有恢复提交。因此 attach 场景的 `tui.text` + `appendEnter` 通过 `@opencode-ai/sdk@1.18.3` 的 `session.promptAsync` 提交到同一真实会话，ConPTY 继续采集原版 TUI 响应；standalone TUI 和普通导航键仍使用 PTY。

attach 会话的 Agent/MCP 循环运行在 CodeArts server 进程，而不是 attach TUI 进程。若要求把原始 MCP Audit 聚合进本轮 Evidence，必须在启动 server 前把 `GAMEFORGE_MCP_AUDIT_DIR` 指向 `.gameforge-validation/<experiment>/sessions/<session-id>/mcp-audit`，并向 Harness 传入同一个 `--session-id`。只给 attach 进程设置该变量不会改变已运行 server 的 MCP 环境；未预绑定时 RunEvent 仍可完成，但 `mcp-audit.json` 会为空，原始审计保留在 server 启动配置的目录。

Harness 不对同一个 Task/Run 发起 fallback 重试。HTTP 429、rate-limit 或 quota 只作为失败诊断记录，避免在已发生权威状态变更后重复 MCP 调用、RunEvent 或 Provider 成本；外部 Provider 也不会因环境中的密钥被自动启用。

headless 使用 `@xterm/headless@6.0.0` 解析唯一 ConPTY VT 流；headed 额外以 `@xterm/xterm@6.0.0` 打开独立可见观察窗，但不创建第二 CodeArts 会话。attach 提交使用 `@opencode-ai/sdk@1.18.3`，OpenChamber 由 `playwright-core@1.61.1` 驱动原版页面。每次场景自动保存 `loaded`、`before-interaction`、`after-interaction`、`success` 或 `failed` 阶段截图，并记录 console/page/failed-request 诊断。当前约束明确不录制视频。

Windows ConPTY 的 `stop()` 只有在整棵受管进程树退出后才能 resolve。`bun-pty@0.4.10` 的 `kill()` 会在发出原生终止请求后同步触发退出事件，但此时 `bun run codearts` 的后代进程仍可能存活并占用 cwd；Harness 因此等待 `taskkill.exe /T /F` 完成，再以 PID 探针确认根进程消失。5 秒内无法收敛必须作为 cleanup 失败上报，不能返回伪造的 exited 状态。并发 `start()` 必须只有一个成功；旧进程树停止完成前必须拒绝新 `start()`；并发 `stop()` 必须共享同一项清理工作，任一调用返回时目标 PID 都已经消失。若 `stop()` 到达时 `start()` 已进入异步目录初始化但尚未 spawn PTY，必须取消并等待该次启动收敛，不能静默返回后让进程继续启动。PTY 已 spawn 但欢迎界面前启动失败时，`start()` 必须自行执行失败清理；同一驱动随后可以重新 `start()`，旧 PTY 的 data/exit 回调不得污染新会话状态。

运行时依赖的锁定版本、上游来源、许可证、选型原因、官方能力缺口与运行时传递依赖记录在 `dependency-review.json`。`bun run --filter @gameforge/ui-test-harness verify:dependencies` 会把该记录与工作区声明及 `bun install --frozen-lockfile` 产生的已安装 manifest 逐项核对；根级 `bun run check` 也执行这一门禁。

最终 `success` 截图若仍包含 console error、page error 或 failed request，场景必须失败，即使 Relay Authority 已经 completed。failed request 同时包含传输层失败和 HTTP 4xx/5xx 响应。唯一例外是 OpenChamber 读取尚未创建的用户项目配置 `.config/openchamber/projects/*.json` 或项目配置 `.openchamber/openchamber.json` 时产生的已知 404；过滤同时要求 `/api/fs/read`、精确路径后缀和 404 状态，其他资源 404 仍进入门禁。Bun 负责 ConPTY/controller；一个薄 Node helper 承载官方 Playwright，避免 Bun 直接浏览器管道兼容问题，不实现浏览器协议。

Driver 对已经位于同一规范化 loopback URL 的 `navigate` 执行 no-op，避免重复 `page.goto` 制造 `ERR_ABORTED`；不同 URL 仍执行真实导航。console error Evidence 同时保留 Playwright 报告的来源 URL 与行列位置，不能只记录无来源的通用错误文本。

异步 GUI 状态必须通过显式 `gui.wait` 场景步骤等待，支持 Playwright locator 的 `attached`、`detached`、`visible` 与 `hidden` 状态；逐步超时必须是 `1`–`900000` 毫秒的安全整数，`0` 不得用于禁用超时。条件满足后记录 `after-gui-wait` 截图，超时则场景失败。不得用固定 sleep 或通用 `networkidle` 冒充业务完成条件。

Authority gate 的初始活动采样、快照、Evidence 记录、轮询延迟和后续采样共享同一个 `timeoutMs` deadline；任一步骤停止响应时 Controller 也必须按时停止等待。快照即使最终返回可接受终态，只要到达时已经超时，也必须以 `Authority gate timed out` 失败，不能把迟到结果误报为通过。若可接受快照在 deadline 前已经返回，则权威终态立即成立，Controller 随后完整记录该快照，不得因 Evidence 写入跨过 deadline 把已完成的 Task/Run 反转为超时。非终态 Evidence 写入发生 deadline race 时，其 Promise 终态必须继续被观察，并在最终 `finalize()` 前收敛，避免迟到拒绝或写入穿越最终提交屏障。

构建产物必须通过独立 Bun 进程调用 Node Playwright helper 的黑盒用例，验证 `gui.wait`、截图、空诊断与成功 `close()` 后父进程自然退出；Windows 用例还必须确认 `close()` 返回时 Node helper 及其已启动的 Chromium 后代 PID 均已消失，不能在 `browser.close()` 完成前强杀 helper，也不能在 `browser.close()` 返回后用 `process.exit()` 截断尾部资源释放。并发 `close()` 必须共享同一项进行中的清理工作，任一调用成功返回都代表清理已经完成；旧 helper 关闭完成前必须拒绝新的 `launch()`。本地 Node Playwright 测试不能替代这条跨运行时门禁。远程页面启动失败时 `launch()` 必须自行回滚已经创建的 helper，无需调用方追加 `close()`；已经成功启动后再次 `launch()` 必须拒绝，不能用第二个 helper 覆盖首个进程句柄。

Playwright 与可视 xterm helper 在启动成功、spawn 失败、提前退出或启动超时后都必须清除启动等待定时器；Playwright helper 在报告有效 endpoint 前退出时必须立即拒绝 `launch()`，即使 stdout 已经包含空白换行，也不能等待完整 35 秒超时。xterm helper 提前退出必须立即拒绝 `open()`，不能继续等待完整超时。调用方捕获启动失败并执行 `close()` 后，Bun 进程不得因残留 timer 继续存活。

Windows 构建产物必须通过真实 headed Chrome/xterm 黑盒验证成功关闭：`close()` 结束 helper stdin 后等待 Node helper 的实际 exit，最多 5 秒；返回时 helper 及其启动后创建的 Chromium 后代 PID 必须已经不存在，不能只发送关闭信号后立即丢弃进程句柄。并发 `close()` 必须共享同一项清理，关闭完成前拒绝新的 `open()`；helper ready 后的终端或输出订阅初始化失败必须由 `open()` 自行回滚，无需调用方补充 `close()`。PID 黑盒必须按 helper 命令行定位进程，并排除创建时间早于 helper 的 PID 复用误匹配。

OpenChamber 连接外部 CodeArts/OpenCode server 时，应在 OpenChamber 启动前设置 `OPENCODE_HOST=<loopback-origin>` 与 `OPENCODE_SKIP_START=true`，再通过公开的 `POST /api/opencode/directory` 登记真实项目目录。最小闭环在 Authority 完成后向页面发送一次 `Escape`，关闭 OpenChamber 异步项目同步可能遗留的目录对话框，保证最终截图展示实际项目和会话状态。

## 已实现的适配器

1. Windows CodeArts TUI：唯一 ConPTY 负责原版 TUI 输出与导航输入，attach 任务通过官方 Session API 提交到同一会话，独立 xterm 观察窗订阅同一 VT 流。
2. OpenChamber GUI：使用 `playwright-core` headed/headless 浏览器驱动，保持上游原版界面不变。
3. GameForge Authority：连接现有 Relay HTTP/SSE，只读 Task、Run、RunEvent。
4. Evidence：写入 `.gameforge-validation/<experiment>/sessions/<session-id>/`，执行大小上限与脱敏，并在 `metadata.json` 记录 `sessionId/taskId/runId/projectId`。每个 session 只允许一个 Harness Evidence 写者；锁从首次写入保持到 `finalize()` 完成，活动写者存在时其他进程必须明确拒绝，崩溃残锁只在同主机、超过保守期限且 owner PID 已确认消失后恢复。同一 sink 内的 NDJSON 大小检查与追加仍按目标文件串行，不能因并发检查共同突破 8 MiB 上限。CodeArts server 写入 `mcp-audit/` 的独立原子审计文件是合法外部 producer，不受该 Harness 单写者锁约束；调用方必须先让 producer 静默，再执行最终聚合。

`result.json` 是 Evidence 最终提交标记，只能在 MCP Audit 聚合成功后写入；聚合失败时不得留下宣称 completed 的结果文件。`finalize()` 开始后必须拒绝新的公开 `record*` 调用，并等待此前已经接受的写入全部收敛，再聚合、发布结果和释放锁；因此最终提交之后不得出现迟到 Evidence。同一 sink 的并发 `finalize()` 必须共享同一项最终提交与锁释放工作，不能重复删除或关闭 session 锁。若场景本身已经失败，排空 TUI 输出时发现的 Evidence 写入失败仍必须作为带上下文的次级失败保留；`EvidenceSink.finalize()` 随后失败时也必须同时保留主失败和最终化失败，不能吞掉任何已观察到的证据损坏。

导入本包不会启动进程或窗口。后续适配器必须保证启动失败可回滚、close 幂等，并把同一 sessionId 贯穿 ConPTY、xterm、OpenChamber 与 Evidence。Controller 在调用 TUI observer `open()` 前即取得清理责任，因此 observer 分配窗口 helper 后再拒绝时仍必须调用 `close()`，且不得继续启动 GUI。
