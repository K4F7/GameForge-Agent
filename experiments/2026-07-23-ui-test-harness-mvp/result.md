# 第一部分测试工具 MVP 验收

日期：2026-07-23

## 实现范围

- 唯一 Bun ConPTY 启动原版 CodeArts TUI；官方 `@xterm/headless@6.0.0` 解析同一 VT 流。
- headed 模式通过官方 `@xterm/xterm@6.0.0` 打开独立可见观察窗，不创建第二 Agent 会话。
- `playwright-core@1.61.1` 通过薄 Node helper 驱动原版 OpenChamber；Bun controller 与 helper 仅使用 loopback HTTP 命令边界。
- 自动保存 loaded、before-interaction、after-interaction、success/failed 阶段 PNG，并收集 console/page/failed-request。
- metadata、GUI、Authority、VT、MCP Audit 通过 `sessionId/taskId/runId/projectId` 关联。
- 最终浏览器诊断非零时场景失败；Authority completed 不覆盖浏览器失败。

依赖均锁定版本且为 MIT。Playwright/xterm 提供浏览器与 VT 通用能力；GameForge 只保留进程编排、字段关联、Evidence 和门禁薄适配。

## 自动验证

- `bun run --filter @gameforge/ui-test-harness check`：通过。
- `bun run --filter @gameforge/ui-test-harness test`：4 个文件、13 个测试通过；包含真实 loopback Playwright PNG 和同流 xterm 解析。
- `bun run --filter @gameforge/ui-test-harness build`：通过。
- `bun run --filter @gameforge/integrations test`：4 个文件、15 个测试通过。
- headed xterm smoke：独立窗口启动，快照 `visible:true`，写入同一 source 后幂等关闭。

## 真实主链

生产前共保留两类失败证据：系统 Chrome/Bun 调试管道超时促成 Node helper；OpenChamber HMR 长运行出现 optimize cache 500/504，促成生产构建验证和浏览器健康门禁。

最终 CodeArts 主链证据位于忽略目录 `.gameforge-validation/2026-07-23-ui-test-harness-mvp-production/`：

- Task `task-4d293afb-d511-4baf-b317-c4584058eb3a`，Run `ui-harness-1784750432692-a72eecc2`。
- Task/Run completed，RunEvent sequence 5；同一 session 下保存五阶段截图、VT、xterm observer、MCP Audit 和 Authority。
- CodeArts/MCP/Authority 成功；OpenChamber 最终发现 4 个 console error 和 2 个 failed request（缺失动态静态资源与 manifest），健康门禁按预期将场景判为失败。
- 这证明工具不会用 Authority completed 掩盖 GUI 回归。被测 OpenChamber 资源问题不在本次测试工具修改范围内。

原版 OpenChamber 探针固定 `1.16.2`、commit `31b43fbde90d368c5d131ec52e761d888466d597`、MIT。正式运行应先 `cd vendor/openchamber`，再执行 `bun run build:web`，并在同一工作目录的未占用 loopback 端口执行 `node packages/web/bin/cli.js serve --foreground --port <port>`；不得以 HMR smoke 代替生产浏览器验收。
