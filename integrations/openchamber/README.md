# OpenChamber 原版接入

第一版直接运行官方 [OpenChamber](https://github.com/openchamber/openchamber) Web GUI，并把它连接到 CodeArts 26.6.x 的 OpenCode-compatible headless server。当前固定上游提交为 `f9ad0de3e5e7cf281dd4966391409f3e19de4e79`（1.16.2）。

接入层不复制或修改 OpenChamber UI，不实现新的 Session、Agent 或工具循环。CodeArts 仍负责模型与 MCP；OpenChamber 使用自己的 Runtime API 和 `@opencode-ai/sdk`。GameForge 后续功能优先通过 OpenChamber 已有接口、MCP 或独立插件扩展。

## 启动

首次准备固定上游 checkout：

```powershell
bun run openchamber:bootstrap
```

终端一启动 CodeArts server，并只允许本地 OpenChamber origin：

```powershell
bun run codearts:serve -- --cors http://127.0.0.1:3000 --cors http://localhost:3000
```

终端二启动原版 OpenChamber：

```powershell
bun run openchamber:serve
```

浏览器打开 `http://127.0.0.1:3000/`。只读兼容性门禁：

```powershell
bun run openchamber:probe
```

默认 checkout 位于忽略目录 `.third-party/openchamber`，OpenChamber 状态位于 `.gameforge-validation/integrations/openchamber/data`。可用绝对路径环境变量 `GAMEFORGE_OPENCHAMBER_ROOT` 和 `GAMEFORGE_OPENCHAMBER_DATA_DIR` 覆盖；不同客户端不得共用数据目录。

当前门禁检查 OpenChamber/CodeArts 健康状态，以及 project、provider/model、agent、MCP 和 session 只读接口。它不创建会话、不发送提示、不调用模型。
