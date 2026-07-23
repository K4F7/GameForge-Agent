# UI Test Harness

这是 CodeArts 原版 TUI 与 OpenChamber 原版 GUI 的外置测试控制层，不是第三套产品 UI。

当前 MVP 提供真实 ConPTY、官方 xterm.js 同流观察、Playwright OpenChamber 驱动、Relay Authority 和文件证据适配器。导入模块不会启动进程、浏览器或测试会话，只有显式 CLI 才执行验收。

## 固定边界

- `CodeArtsTuiDriver` 只驱动真实 CodeArts 交互式 TUI；禁止以 pipe、数据库写入或伪造会话替代 PTY 输入。
- `CodeArtsTuiObserverDriver` 固定使用独立 xterm 窗口渲染上述唯一 ConPTY 的同一 VT 输出；它不创建第二个 CodeArts 会话。
- `OpenChamberGuiDriver` 通过真实浏览器操作原版 OpenChamber 页面；测试框架不得修改 OpenChamber，也不得注入终端面板或测试专用业务 UI。
- 两个被测窗口彼此独立。控制器可以同时观察它们，但 OpenChamber 不承载 CodeArts TUI。
- `GameForgeAuthorityDriver` 单独读取 Task、Run 与 RunEvent；阶段通过只接受该权威状态，不解析模型自然语言。
- `EvidenceSink` 保存输入、TUI 屏幕、GUI 诊断、权威状态和生命周期；敏感原件只能落到仓库忽略目录。
- `UiTestController` 负责编排、观察保留与综合活动看门狗，不实现 Agent 循环。

## 当前可运行边界

先启动 Relay 与固定版本的原版 OpenChamber。本机验证版本为 OpenChamber `1.16.2`、commit `31b43fbde90d368c5d131ec52e761d888466d597`（MIT）。浏览器验收应使用 `bun run build:web` 后的生产服务；HMR 只用于开发，不作为长期诊断门禁依据。随后运行：

```powershell
bun run --filter @gameforge/ui-test-harness run:headless
# 或显式可见的两个独立窗口
bun run --filter @gameforge/ui-test-harness run:headed
```

默认 OpenChamber URL 为 `http://127.0.0.1:5173/`，可用 `--openchamber-url` 或 `GAMEFORGE_OPENCHAMBER_URL` 覆盖，但只接受无凭据 loopback HTTP(S)。该命令使用真实 Bun ConPTY 启动 `bun run codearts`，连接既有 Relay，并将 VT、生命周期、活动样本、Authority 快照、MCP Audit、浏览器诊断和 PNG 截图写入 `.gameforge-validation/`。默认活动超时 120 秒，总门禁 15 分钟；headed 成功后默认保留窗口 10 秒。

需要把预先启动的外部 Observer 与 Harness Evidence 关联时，可显式传入 `--session-id <id>`。单次权威执行使用该 ID 关联 Evidence。

Harness 不对同一个 Task/Run 发起 fallback 重试。HTTP 429、rate-limit 或 quota 只作为失败诊断记录，避免在已发生权威状态变更后重复 MCP 调用、RunEvent 或 Provider 成本；外部 Provider 也不会因环境中的密钥被自动启用。

headless 使用 `@xterm/headless@6.0.0` 解析唯一 ConPTY VT 流；headed 额外以 `@xterm/xterm@6.0.0` 打开独立可见观察窗，但不创建第二 CodeArts 会话。OpenChamber 由 `playwright-core@1.61.1` 驱动原版页面。每次场景自动保存 `loaded`、`before-interaction`、`after-interaction`、`success` 或 `failed` 阶段截图，并记录 console/page/failed-request 诊断。当前约束明确不录制视频。

运行时依赖的锁定版本、上游来源、许可证、选型原因、官方能力缺口与运行时传递依赖记录在 `dependency-review.json`。`bun run --filter @gameforge/ui-test-harness verify:dependencies` 会把该记录与工作区声明及 `bun install --frozen-lockfile` 产生的已安装 manifest 逐项核对；根级 `bun run check` 也执行这一门禁。

最终 `success` 截图若仍包含任意 console error、page error 或 failed request，场景必须失败，即使 Relay Authority 已经 completed。Bun 负责 ConPTY/controller；一个薄 Node helper 承载官方 Playwright，避免 Bun 直接浏览器管道兼容问题，不实现浏览器协议。

## 已实现的适配器

1. Windows CodeArts TUI：唯一 ConPTY 负责真实输入输出，独立 xterm 观察窗订阅同一 VT 流。
2. OpenChamber GUI：使用 `playwright-core` headed/headless 浏览器驱动，保持上游原版界面不变。
3. GameForge Authority：连接现有 Relay HTTP/SSE，只读 Task、Run、RunEvent。
4. Evidence：写入 `.gameforge-validation/<experiment>/sessions/<session-id>/`，执行大小上限与脱敏，并在 `metadata.json` 记录 `sessionId/taskId/runId/projectId`。

导入本包不会启动进程或窗口。后续适配器必须保证启动失败可回滚、close 幂等，并把同一 sessionId 贯穿 ConPTY、xterm、OpenChamber 与 Evidence。
