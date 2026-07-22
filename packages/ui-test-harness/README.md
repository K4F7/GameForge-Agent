# UI Test Harness

这是 CodeArts 原版 TUI 与 OpenChamber 原版 GUI 的外置测试控制层，不是第三套产品 UI。

当前提交只建立可审查的控制契约和阶段机，不包含自动启动入口，也不会在导入模块时启动进程、浏览器或测试会话。

## 固定边界

- `CodeArtsTuiDriver` 只驱动真实 CodeArts 交互式 TUI；禁止以 pipe、数据库写入或伪造会话替代 PTY 输入。
- `CodeArtsTuiObserverDriver` 固定使用独立 xterm 窗口渲染上述唯一 ConPTY 的同一 VT 输出；它不创建第二个 CodeArts 会话。
- `OpenChamberGuiDriver` 通过真实浏览器操作原版 OpenChamber 页面；测试框架不得修改 OpenChamber，也不得注入终端面板或测试专用业务 UI。
- 两个被测窗口彼此独立。控制器可以同时观察它们，但 OpenChamber 不承载 CodeArts TUI。
- `GameForgeAuthorityDriver` 单独读取 Task、Run 与 RunEvent；阶段通过只接受该权威状态，不解析模型自然语言。
- `EvidenceSink` 保存输入、TUI 屏幕、GUI 诊断、权威状态和生命周期；敏感原件只能落到仓库忽略目录。
- `UiTestController` 负责编排、观察保留与综合活动看门狗，不实现 Agent 循环。

## 待实现的适配器

1. Windows CodeArts TUI：唯一 ConPTY 负责真实输入输出，独立 xterm 观察窗订阅同一 VT 流。
2. OpenChamber GUI：使用 `playwright-core` headed/headless 浏览器驱动，保持上游原版界面不变。
3. GameForge Authority：连接现有 Relay HTTP/SSE，只读 Task、Run、RunEvent。
4. Evidence：写入 `.gameforge-validation/<experiment>/sessions/<session-id>/`，并执行大小上限与脱敏。

具体适配器经过代码审查前不提供 `run` CLI；导入本包不会启动进程或窗口。适配器必须保证启动失败可回滚、close 幂等，并把同一 sessionId 贯穿 ConPTY、xterm、OpenChamber 与 Evidence。
