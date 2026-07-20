# Workbench Task 历史恢复结果

## 实现

- Workbench client 新增严格、只读的 `listGameTasks`；
- UI 可刷新最近 20 个 Task，显示状态、目标项目和 Run ID；
- 载入时先断开旧视图、执行 `ui.reset`，再恢复 Task 的 Prompt、语言、可选项目 ID，并从 sequence 0 回放；
- 历史操作不调用 MCP、模型、claim、complete 或 stop。
- 连续刷新用请求代次丢弃迟到响应，避免旧列表覆盖新列表；Relay SSE 不再把正常 socket 背压误判为失败并截断连接。

## 初步验证

- Workbench TypeScript 严格检查通过；
- Workbench 5 个测试文件、38 个测试通过；
- 客户端测试覆盖请求边界、limit query 与严格 Task 响应解析。

- 真实本地 Relay 创建 `history-real-20260718`，Task 携带 `projectId: history-game`；
- Playwright 点击“刷新历史”后看到 1 项权威 Task，点击“载入历史”后恢复原 Prompt、语言、项目、Task/Run ID，并连接至 sequence 1；
- 浏览器截图确认历史控件保持在左侧任务卡内，没有遮挡预览或阶段面板；
- 临时 4173/8787 服务验收后均已关闭。

- `bun install --frozen-lockfile`：198 个安装、281 个包，无变更；
- `bun run check`：通过；
- `bun run test`：271 个测试通过；
- `bun run build` 与 `bun run bundle:check`：通过，保留已知 Phaser 异步 chunk 大于 500 kB 提示；
- MCP、Chrome、Desktop doctor 均 `ok: true`；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过。

## 边界

- Relay 未配置状态文件时，进程重启后历史仍会丢失；
- 页面不保存私有游标，而是从 sequence 0 权威回放；
- 切换视图不会停止仍在后台执行的 Run。
