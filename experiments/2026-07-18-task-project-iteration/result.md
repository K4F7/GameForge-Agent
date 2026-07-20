# Task 显式项目迭代结果

## 实现

- Task 请求与实体新增严格、可选 `projectId`，Relay 快照和 MCP claim 沿现有 Schema 原样传递；
- 同一 Run ID 的幂等比较包含 `projectId`，避免重试时悄然切换目标项目；
- Workbench 增加“继续项目（可选）”输入，留空创建新项目，“新任务”会清空旧选择；Bun TUI 增加 `--project-id`；
- CodeArts Skill 规定 Task 有 ID 时 update dry-run/CAS apply，无 ID 时 create，禁止猜测。

## 验证

- 首次定向测试在未先重建 contracts dist 时，下游三个包正确拒绝未知字段；执行仓库 foundation build 后重跑通过，这一结果记录了 workspace 预构建顺序要求；
- contracts：40 个测试通过；
- run-relay：28 个测试通过；
- Workbench：37 个测试通过；
- TUI：16 个测试通过；
- `bun run check`：通过。

- 整仓 `bun run test`：270 个测试通过；
- `bun run build`：通过，保留已知 Phaser 主 chunk 大于 500 kB 警告；
- `bun install --frozen-lockfile`：198 个安装、281 个包，无变更；
- `bun run doctor`、`bun run doctor:browser`、`bun run doctor:desktop`：均 `ok: true`；
- `bun run audit`：0 个生产依赖漏洞；
- Playwright 真实浏览器确认字段标签、占位提示和输入值可见，未遮挡预览或阶段面板；未启动的 Relay/预览产生预期连接错误；
- `git diff --check`：通过。

## 边界

- 本实验验证确定性本地链路，不调用云 Provider；
- `projectId` 只选择生成器受管项目，不能绕过 update 的冲突与 CAS 保护；
- 每次迭代仍创建独立、不可变的新 Run，旧 Run 不被改写。
