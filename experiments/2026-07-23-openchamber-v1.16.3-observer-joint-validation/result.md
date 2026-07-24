# OpenChamber v1.16.3 与 CodeArts Observer 联合验收

日期：2026-07-23

## 输入与验收目标

- 验证 OpenChamber v1.16.3 生产构建是否消除 v1.16.2 的动态 chunk 与 manifest 回归。
- 在当前工作树运行局部与整体 `check`、`test`、`build`。
- 使用真实 CodeArts Task 联合采集 VT、MCP Audit、Relay Authority、OpenChamber 截图和原始 `/global/event` SSE。
- 不部署、发布、上传，不调用外部媒体 Provider；未配置或触发模型 fallback。

## 准确版本

- OpenChamber：`v1.16.3`，commit `8040d43b251a015eb06d96135a442abd4d2f2e27`。
- CodeArts Agent：26.6.2。
- OpenCode CLI：1.18.4。
- Observer SDK：`@opencode-ai/sdk@1.18.3`。
- Playwright：`playwright-core@1.61.1`。

## 第一阶段：OpenChamber v1.16.3

事实：

- `bun install --frozen-lockfile`：退出码 0，13.9 秒，安装 3169 packages。
- `bun run build:web`：退出码 0，72.2 秒，Vite 转换 2653 modules；只有 chunk 大小与静态/动态混合导入警告。
- 生产入口：`node packages/web/bin/cli.js serve --foreground --port 43163 --plain`，固定 loopback。
- 有效 smoke 使用现有 `PlaywrightOpenChamberDriver`，保持 75 秒；`loaded`、`before-interaction`、`after-interaction`、`success` 四阶段截图均已保存，最终 console error、page error、failed request 均为 0。
- `GET /assets/useAppFontEffects-C3qBvWKE.js`：200，`text/javascript`，3025869 bytes。
- `GET /manifest.webmanifest?orientation=system`：200，`application/manifest+json`，1249 bytes。

结论：在有效生产服务窗口内，v1.16.3 已消除此前观察到的动态 chunk 与 manifest 回归。原始截图和 `smoke-result.json` 位于已忽略目录：

`.gameforge-validation/2026-07-23-openchamber-v1.16.3-validation/sessions/openchamber-v1.16.3-final-smoke/`

两次被外层命令时限终止服务的探针不作为产品结论；其连接拒绝/重置仅作为实验控制失败保留。

## 第二阶段：当前工作树回归

全部命令退出码均为 0：

- `bun run --filter @gameforge/ui-test-harness check`
- `bun run --filter @gameforge/ui-test-harness test`：4 files，14 tests。
- `bun run --filter @gameforge/ui-test-harness build`
- `bun run --filter @gameforge/integrations check`
- `bun run --filter @gameforge/integrations test`：4 files，15 tests。
- `bun run --filter @gameforge/integrations build`
- `bun run check`
- `bun run test`：63 test files、378 tests 通过；`apps/game` 无测试文件并按配置退出 0。
- `bun run build`：通过；游戏产物有大于 500 kB 的既有 Vite warning。
- `bun run codearts -- --dry-run`
- `bun run opencode -- --dry-run`

新增 `--session-id` 后再次运行 Harness 局部 check/test/build，退出码均为 0，仍为 4 files、14 tests。

## 第三阶段：真实 Task 与 Observer

固定关联：

- Harness/Observer session：`joint-session-20260723-1414`。
- Task：`task-3ec61467-9aab-4293-892a-3fb59676bf34`。
- Run：`joint-run-20260723-1414`。
- Project：`joint-project-20260723-1414`。

已证明事实：

- Relay Authority：Task `completed`、Run `completed`、最终 sequence 6、`run.completed`。
- MCP Audit：7 次调用；`claim_game_task`、`get_gameforge_capabilities`、`bind_mcp_audit_context`、`replay_game_run`、`publish_run_events`、`complete_game_run` 成功；无项目的 `get_project_assets` 按预期返回 error。
- 首次单 Observer 运行保存 25 条原始 CodeArts 事件，事件类型只观察到 `server.connected` 与 `server.heartbeat`；所有 `sseId` 均为 `null`。
- 原始 Observer Evidence 保留 `type/properties/raw`，并通过相同 session/run 元数据与 Harness 关联。
- Harness Evidence 保存 VT、浏览器截图、Authority 与 MCP Audit；MCP Audit 内部客户端 session ID 独立，但绑定了同一 taskId/runId。

未通过与未证明项：

- 联合运行最终浏览器门禁失败。报告先因 Harness 对同 URL 再次 `navigate` 记录两个 `ERR_ABORTED`，随后 OpenChamber 服务中止并产生连接错误；Authority completed 没有掩盖 GUI 失败。第一阶段独立生产 smoke 为零诊断，但“同一次真实 Task 的 GUI 零诊断”尚未闭合。
- CodeArts 业务期内仍只观察到 server 级事件，未观察到 Session/Message/Part 业务 payload，因此不能声称 CodeArts 业务 schema 与 OpenCode 一致。
- 未观察到 SSE `id:`，因此不能实证 `Last-Event-ID` 行为。
- 受控重启时，终止外层命令没有清理 Bun Observer 子进程；两个写者并发追加同一文件，产生重复 sequence 34–40。该重连证据无效，并证明当前 Observer 缺少单写者锁。遗留 Observer 进程已按精确 PID 清理。

## 人工干预、429 与 fallback

- 人工干预：启动/停止本地生产服务与探针、在发现外层时限污染后重跑、精确清理遗留 Observer 进程；没有浏览器手工点击或 CodeArts TUI 输入。
- 未观察到 HTTP 429、rate-limit 或 quota。
- 未触发 fallback；未调用外部媒体账号。

## 修改与剩余风险

- `packages/ui-test-harness/src/cli.ts`：增加可选 `--session-id`，并为 fallback 使用后缀，支持 Observer 与 Harness 共享 Evidence ID。
- `packages/ui-test-harness/README.md`：记录新参数语义。
- 本实验结果文档。

剩余风险：OpenChamber 生产服务的受控生命周期需要独立、可监测的持久进程管理；Harness 的同 URL `gui.navigate` 会制造可预期的 abort 诊断；Observer 需要单写者锁、可靠子进程清理，以及真实业务事件与 SSE ID 的后续实证。

## 后续复验：重复导航与延迟配置探测

当前 HEAD 已完成两项 TDD 修复并通过真实 Bun/Node helper 路径复验：

- `launch(url)` 后再次 `navigate(url)` 不再触发第二次文档请求；真实联合运行未再出现 `ERR_ABORTED`。
- console error Evidence 现在保留 Playwright `location()` 的 URL、行号和列号，避免只记录无法定位的 `Failed to load resource`。

真实 CodeArts 最小任务 `task-704c6dbe-4b47-46ea-896e-aad72e13ab6f`、Run `ui-harness-1784822571736-ff7c1381` 的 Authority 均 completed，RunEvent 到 sequence 6；MCP Audit 共 9 次调用，8 次成功，`get_project_assets` 因无项目资产按预期返回 error。Harness 最终仍因 4 个 console error 失败，证明 Authority completed 未掩盖 GUI 问题。

修复诊断来源后保持生产页面 160 秒，4 个错误被确定为两个缺失可选配置文件各请求两次：

- `/api/fs/read?path=.../.config/openchamber/projects/<project-id>.json`：404；
- `/api/fs/read?path=.../.openchamber/openchamber.json`：404。

OpenChamber v1.16.3 前端配置读取明确把缺失文件解释为 `null`，但 Web fallback 未传服务端已支持的 `optional=true`，因此浏览器仍记录资源 404。`v1.16.3` 是当前最新正式标签，`dev-latest` 也未包含对应修复。本仓库不在 Harness 中忽略或重写该请求，也不修改 submodule 源码；该项保留为上游缺陷。manifest 与 `useAppFontEffects` 动态 chunk 在本次复验中均未失败。
