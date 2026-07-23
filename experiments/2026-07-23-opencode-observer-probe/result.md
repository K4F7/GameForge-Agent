# OpenCode Observer 与 CodeArts 事件接口探针

日期：2026-07-23

## 输入与边界

- 目标：验证本机 OpenCode/CodeArts 是否真实暴露官方观察器所需的 SSE 接口。
- OpenCode：1.18.4；Observer SDK：锁定 `@opencode-ai/sdk@1.18.3`（MIT）。
- CodeArts：26.6.2。
- 两个服务均使用独立、被 Git 忽略的数据目录，仅监听 loopback，`--pure` 禁用外部插件。
- 未调用模型、未认领 Task、未读取认证或会话正文、未使用外部账号；人工干预仅为启动与停止短生命周期探针。

## 结果

| 客户端 | `/global/event` | `/event` | `/` | `/openapi.json` |
| --- | --- | --- | --- | --- |
| OpenCode 1.18.4 | 200，连接持续 | 200，连接持续 | 500 | 500 |
| CodeArts 26.6.2 | 200，连接持续 | 200，连接持续 | 500 | 500 |

CodeArts stdout 明确报告 loopback server 已监听；全新隔离目录完成本地 SQLite migration。两个 SSE 请求因探针两秒上限主动超时，符合持续事件流行为。

## 事实与限制

- 事实：CodeArts 26.6.2 真实暴露 `/global/event` 与 `/event`，不是仅能通过 VT/MCP Audit/Relay 观察。
- 事实：官方 SDK SSE 客户端支持自动重连、指数退避和 `Last-Event-ID`；Observer 直接使用该能力。
- 尚未证明：CodeArts 的所有事件类型、payload schema 和 SSE `id:` 都与 OpenCode 相同。本次无业务事件产生，不能据状态码推断。
- OpenCode CLI 1.18.4 与锁定 SDK 1.18.3 存在补丁版本差；真实业务事件兼容性仍需后续验收。

## 验证命令

- `bun run --filter @gameforge/integrations check`：通过。
- `bun run --filter @gameforge/integrations test`：通过，4 个测试文件、15 个测试。
- `bun run --filter @gameforge/integrations build`：通过。
- `bun run opencode -- --dry-run`、`bun run codearts -- --dry-run`：通过，数据目录隔离。
