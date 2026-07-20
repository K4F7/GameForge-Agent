# 实验环境

- 日期：2026-07-16
- 时区：Asia/Shanghai
- Bun：1.3.14，负责依赖安装、workspace 脚本、检查、测试和构建。
- Node：24.18.0，承载 Playwright Core；与 MCP 的 Node shebang 生产运行方式一致。
- Chrome：`C:\Program Files\Google\Chrome\Application\chrome.exe`，版本 150.0.7871.124。
- Playwright Core：1.61.1。
- Phaser：4.2.1。
- Vite：8.1.4。
- 网络：Verifier 页面只允许本次 loopback Vite origin、`data:` 和 `blob:`。
- 产物根目录：仓库忽略目录 `.gameforge-validation/`。

Bun JavaScript runtime 直接调用 `chromium.launch()` 在本机超时；最小诊断确认同一 Chrome 在 Node 下可正常启动和关闭。因此浏览器验收使用正式 MCP 对应的 Node runtime，包管理和工程命令仍统一使用 Bun。
