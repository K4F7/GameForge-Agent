# UI Test Harness 最小闭环实验结果

日期：2026-07-23

## 输入任务

真实 CodeArts TUI 通过 ConPTY 接收一个预置 Task，要求使用固定 agentId 认领 Task、绑定 MCP Audit、调用确定性只读 MCP 工具、发布 RunEvent 并完成 Run。禁止部署、发布、上传和外部媒体 Provider。

## 环境与模型

- 客户端：CodeArts Agent 26.6.2；
- baseline：CodeArts 内置 `huaweicloud-maas/GLM-5.1`（TUI 实际显示）；
- fallback：显式配置为 `grok-4.5`，仅允许明确 429、rate-limit 或 quota 时触发；
- 超时：短探针 30/60 秒活动超时，最终探针 60 秒活动超时、180 秒总门禁。

## 过程与人工干预

1. 首次探针发现输入在 TUI ready 前注入，Task 保持 queued；修正 readiness gate。
2. 第二次探针发现 bracketed paste 与 Enter 同包发送后未提交；改为粘贴结束后延迟发送 Enter。
3. 第三次探针发现 baseline 继承 fallback key 会触发不完整配置校验；改为空值覆盖，确保 baseline 不加载 fallback。
4. 最终探针由框架无人值守运行 193 秒，无人工点击或输入。

## 工具调用与权威结果

- CodeArts 调用了内置 Read/Explore 能力；
- CodeArts TUI 最终显示其判断“没有直接 MCP tools”；
- GameForge MCP Audit 会话已创建，但 `calls` 为空；
- Relay 始终只有 sequence 1 的 `run.started`；
- Task 保持 `queued`，没有 claim、后续 RunEvent 或 complete；
- 未观察到 HTTP 429、rate-limit 或 quota，因此按约定没有触发 fallback，也没有调用自定义模型端点。

## 结论

真实 ConPTY、TUI readiness、文本提交、VT/Evidence 落盘、Relay Authority 轮询和双超时已形成可执行闭环。端到端任务未通过，当前阻塞点是 CodeArts 会话没有发现或调用 GameForge MCP，而不是已证实的模型限流。

原始证据位于忽略目录：

`.gameforge-validation/2026-07-23-ui-harness-submit-probe-3/sessions/fac4a3d2-6232-4c1d-bd8c-8f0755aec292/`

## 阻塞修复与复验

进一步检查 CodeArts 隔离数据目录中的 kernel 日志后确认，GameForge MCP 曾继承宿主残留的 `VOLCENGINE_SPEECH_API_TOKEN`，但没有配套 App ID。MCP 在启动校验阶段直接退出，因此 CodeArts 会话没有注册 `gameforge_*` 工具。该故障与模型限流无关。

动态 MCP 配置现会显式清空当前实验禁用的百炼、Freesound、火山和 MiniMax 凭据，防止宿主的半套外部 Provider 配置污染 MCP 子进程。此隔离不改变 CodeArts 自身认证，也不改变仅在明确 429、rate-limit 或 quota 时启用的模型 fallback。

修复后的真实无人值守复验结果：

- 模型：CodeArts 内置 `huaweicloud-maas/GLM-5.1`；
- 尝试：baseline，未触发 fallback；
- 耗时：约 109 秒；
- Task：`completed`；
- Run：`completed`；
- RunEvent：最终 sequence 8，类型 `run.completed`；
- MCP Audit：8 次调用，`claim_game_task`、`bind_mcp_audit_context`、`replay_game_run`、`get_gameforge_capabilities`、`publish_run_events`、`get_mcp_audit_summary` 和 `complete_game_run` 成功；
- `get_project_assets` 返回错误，因为本任务明确不生成项目，此错误不影响最小闭环验收；
- 人工干预：无。

修复后证据位于忽略目录：

`.gameforge-validation/2026-07-23-ui-harness-mcp-startup-fix/sessions/ba8c547f-af36-48c7-9d7d-7e44ca09e435/`
