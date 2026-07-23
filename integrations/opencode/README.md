# OpenCode Adapter

`bun run opencode` 使用同一套 GameForge MCP/Relay 边界启动 OpenCode。该适配器用于同任务对照实验，不代表 GameForge 核心依赖 OpenCode。

启动器通过 `OPENCODE_CONFIG` 隔离 GameForge MCP 配置，并始终把 `XDG_DATA_HOME` 指向 `.gameforge-validation/integrations/opencode/data`，覆盖调用方已有值。这会同时隔离 `auth.json`；启动器不会复制或输出认证材料。CodeArts 仍使用独立的 `KERNEL_DATA_DIR`，两端不得共享数据库文件。

只读观察器使用锁定的官方 `@opencode-ai/sdk@1.18.3` 订阅 `/global/event`：

选择 SDK 而非手写 REST/SSE，是因为观察器需要官方客户端的 `/global/event` 流解析、SSE ID 传递和重连行为；自行复制协议会形成第二套易漂移实现。该版本采用 MIT 许可并固定在 `integrations/package.json` 与 `bun.lock`。生产准入验证命令为：

```powershell
bun audit --prod
bun run --filter @gameforge/integrations check
bun run --filter @gameforge/integrations test
```

2026-07-23 实际验证结果：类型检查通过，5 个测试文件共 17 个测试通过；审计结果以同一提交的 CI/本地命令输出为准。

```powershell
$env:OPENCODE_SERVER_URL='http://127.0.0.1:4096'
$env:GAMEFORGE_OBSERVER_SESSION_ID='<与验收相同的 sessionId>'
$env:GAMEFORGE_RUN_ID='<可选 runId>'
bun run --filter @gameforge/integrations observe:opencode
```

原始 `directory/payload`、`type/properties`、可用时的 SSE `id:` 以及本地连续 `sequence` 写入忽略目录。官方 SDK 自动以 `Last-Event-ID` 重连；若服务端没有发送 `id:`，记录中的 `sseId` 为 `null`，不得把本地 `sequence` 冒充 OpenCode 原生 ID。`after` 是落盘 Evidence 的只读游标，不代表 OpenCode 服务端支持 `after` 查询参数。

真实同任务记录见 `experiments/2026-07-18-codearts-opencode-douyin-comparison/`。它验证本地 Task/MCP/玩法/构建边界，不代表 OpenCode 取代 CodeArts 主智能体。

当前提交的默认模型策略只包含 CodeArts 内置 DeepSeek/GLM target。上述历史对照中的 `opencode/hy3-free` 是当次用户显式 override，不再作为 OpenCode 启动器的默认 fallback；除非用户另行授权新的对照实验，普通 GameForge Run 不选择跨宿主模型。
