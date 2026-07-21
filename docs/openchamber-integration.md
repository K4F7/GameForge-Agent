# OpenChamber 初步接入

更新日期：2026-07-21

## 当前状态

Workbench 已建立首个 OpenChamber 派生垂直切片：顶部 Runtime 标识和左侧
Task/Run 导航由 GameForge Relay 数据驱动，右侧继续使用现有 RunEvent reducer、
连续 sequence 和断线恢复逻辑。

采用的上游评估提交为
[`31b43fbde90d368c5d131ec52e761d888466d597`](https://github.com/btriapitsyn/openchamber/commit/31b43fbde90d368c5d131ec52e761d888466d597)。
具体归属见 `apps/workbench/THIRD_PARTY_NOTICES.md`。

## 接入边界

- `apps/workbench/src/openchamber-adapter.ts` 把 `GameTask` 与 `RunState` 映射成纯 UI view model；
- `apps/workbench/src/openchamber-ui.tsx` 提供派生的 Runtime header 和 Task/Run 导航；
- `apps/workbench/src/run-client.ts` 仍负责 Relay HTTP、SSE、回放和恢复；
- `apps/workbench/src/run-state.ts` 仍是 RunEvent 权威 reducer；
- 未引入 `@opencode-ai/sdk`、OpenCode session schema、Electron、PTY、Git/SSH 或 tunnel；
- 桌面端继续复用现有 Tauri 2 零 IPC 壳。

## 验收

```powershell
bun run --filter @gameforge/workbench test
bun run --filter @gameforge/workbench build
bun run workbench:smoke
bun run bundle:check
bun run desktop:check
```

第二个垂直切片已把 Manifest、生成计划、update diff 和脱敏 MCP Audit 映射到
OpenChamber 风格的右侧上下文面板。生成工具返回不含主机路径的
`project.generated` 事件草稿；绑定 Task/Run 后，`get_mcp_audit_summary` 返回最多
200 条只含工具名、顺序、状态和耗时的 `mcp.audit.ready` 事件草稿。两者仍由
CodeArts 按权威 cursor 显式发布，Workbench 不读取本机文件或绕过 Relay。

审计投影明确排除参数、结果、Prompt、URL、绝对路径、时间戳、session ID、账号和
密钥；项目投影只接受规范化相对路径及受限文件清单。未发布对应事件时，面板显示
等待状态，不从日志推断或伪造计划、差异和审计结果。

本地 Workbench 不使用默认 `4173` 端口时，可为 Relay 显式增加安全来源：

```powershell
$env:GAMEFORGE_RUN_RELAY_ALLOWED_ORIGINS = "http://127.0.0.1:4177"
$env:GAMEFORGE_RUN_RELAY_PORT = "8788"
node packages/run-relay/dist/index.js
```

该配置拒绝带凭据、路径、query 或 fragment 的 URL，并只接受 HTTPS 或
loopback HTTP。未设置时仍使用 Relay 原有的 `4173` 默认来源。
