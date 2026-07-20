# 真实 CodeArts GameForge 闭环结果

## 结论

首次真实 CodeArts Agent 闭环通过。该证据不是本地 MCP Client 模拟：CodeArts 26.6.2 TUI 自己启动了 `node packages/mcp-server/dist/index.js`，并以 `claimedBy: codearts` 认领 Task。

## 结构化事件

Run `codearts-real-20260718-0145` 最终包含六条连续事件：

1. `run.started`：`language: en-US`；
2. `capabilities.ready`：assetStore、generator、verifier、preview、runRelay、taskInbox 全为 true；Qwen、Seedream、火山 TTS、Freesound 均为 false；
3. `spec.ready`：`Safety Kit Collector`，locale `en-US`，60 秒，2 个 collectible、1 个 hazard、3 条生命、200 px/s；
4. `verification.ready`：passed true、outcome won、score 2、lives 3、remaining 57.35 秒；
5. `preview.ready`：`http://127.0.0.1:5173/`；
6. `run.completed`。

Task 最终状态为 completed，认领和完成时间均由 Relay 权威记录。

## 生成与浏览器证据

生成项目：`.gameforge-validation/codearts-real-e2e/projects/safety-kit-collector/`。

- generatorVersion：0.6.0；
- `specSha256`：`52b65f46614db4a67c182e12d7f421df4b740930f9bb430aed26013d1da9796c`；
- CodeArts 在生成目录执行 Bun 安装与构建，产生 `bun.lock`、`node_modules` 和 `dist`；
- `http://127.0.0.1:5173/game-spec.json` 返回该生成项目的真实英文规格；
- Chrome Canvas：960×540；
- 动作数：7；验收耗时：5437 ms；
- console errors、page errors、failed requests：均为 0；
- 截图：`.gameforge/verification/f196b670-ea5f-4e2a-a087-430d1e05d7bd.png`。

人工视觉检查确认截图显示 `Safety Kit Collector`、`Progress 2/2`、`Lives 3`、`Mission Complete` 与英文重启/控制提示，胜利遮罩清晰且没有中文模板残留。

## 人工干预与边界

- OAuth TUI 无法由非 TTY 终端工具直接接管，用户手工启动并粘贴提示；
- 非交互 `codearts run` 与 `codearts mcp` 仍要求 `CODEARTS_CLI_AK/SK`，本实验没有申请或使用；
- CodeArts 在生成构建后停顿一次，用户追加“继续完成 preview/verification/complete”提示；
- 本次任务明确禁用媒体，因此没有 `asset.ready`，不证明真实 Seedream、Freesound 或火山 TTS 账号调用；
- Chrome 浏览器验收工具证明玩法与画面；Chrome 扩展自动化无法访问本地 Workbench，不影响 Relay、生成项目和系统 Chrome 的权威证据。
