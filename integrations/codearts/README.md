# CodeArts Adapter

`bun run codearts` 使用临时 OpenCode-compatible 配置启动 CodeArts TUI。它只注入 GameForge MCP 的项目输出根和 Relay URL，不替代 CodeArts 的规划、模型或 OAuth。启动器将工作目录固定为仓库根；MCP 对象不使用 CodeArts 26.6.2 会拒绝的非标准 `cwd` 字段。

启动器还显式设置 CodeArts 专用的 `KERNEL_DATA_DIR` 与 `KERNEL_CONFIG_DIR`。不要用同一个数据目录直接交替运行 CodeArts 26.6.x 和独立 OpenCode 1.18.x：两者数据库迁移链不同，可能重复创建或修改表。独立 OpenCode 继续使用自己的默认数据目录；CodeArts 私有目录与认证均不提交仓库。

Relay 可用时，CodeArts 可以经 `ask` 直接调用 `create_game_task` 创建 queued Task 与对应 Run，再以 `agentId: "codearts"` 认领；这条无 GUI 入口不依赖 Workbench。相同创建请求按 run ID 幂等，参数冲突必须停下，不得自动轮换 ID。

## OpenChamber/GUI server spike

`bun run codearts:serve` 使用同一套隔离数据目录和临时 GameForge MCP 配置启动 CodeArts 26.6.x 的 OpenCode-compatible headless server。第一版固定只监听 `127.0.0.1:4096`，默认仅允许本地 Workbench 的 `http://127.0.0.1:4173` 与 `http://localhost:4173` origin。OpenChamber fork 可把其 Runtime API base URL 指向 `http://127.0.0.1:4096/`，但 CodeArts Session 只用于实时交互；Task、RunEvent、Manifest 和 Audit 仍以 GameForge Relay/MCP 为权威来源。

第一版 server 子进程显式不继承百炼、Seedream、Freesound、火山语音和 MiniMax 的账号环境变量，避免 GUI 接驳因宿主环境残留值而隐式启用外部调用或在不完整配置下启动失败；程序化素材与静音回退保持有效。该行为只作用于 server 子进程，不修改当前终端或用户环境。外部 Provider 必须在后续获得明确授权后另立 opt-in 配置，不能通过普通页面切换自动开启。

为 OpenChamber 开发服务器增加 origin 时显式传入，例如：

```powershell
bun run codearts:serve -- --cors http://localhost:3000
```

也可以设置逗号分隔的 `GAMEFORGE_STUDIO_ORIGINS`。启动器拒绝非 HTTPS 的远程 origin，并拒绝把 CodeArts 监听到非 loopback 地址。连接描述写入忽略目录 `.gameforge-validation/integrations/codearts/server.json`，其中不包含密码或其他凭据。

服务器启动后，另一个终端运行 `bun run codearts:server-probe`。探针只读取 `/global/health`、`/doc` 和 `/mcp`，不创建 Session、不调用模型、不认领 Task；结果中的 `mcp.gameforge` 用于确认 CodeArts server 已加载 GameForge MCP。若本机配置了 `CODEARTS_SERVER_PASSWORD`，当前直连 spike 需要由 OpenChamber fork 提供对应的认证 fetch；浏览器不得持有生产 Relay token 或 Provider 密钥。正式桌面版应改为同源本地代理，而不是长期依赖无认证的浏览器直连。

`bun run codearts:server-smoke` 会在忽略目录中创建隔离的临时 CodeArts 数据/配置目录，使用随机 loopback 端口完成同一组只读检查，并在结束时关闭自己启动的子进程。它不会读取常用 CodeArts Session 数据，也不会调用模型；适合作为 OpenChamber fork 接入前的本机兼容性门禁。
