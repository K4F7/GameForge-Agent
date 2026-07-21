# OpenChamber 初步接入

状态：in-progress
更新日期：2026-07-21

## 当前状态

当前版本直接运行原版 OpenChamber Web GUI，不再先重画 Workbench。官方 GUI 通过
`OPENCODE_HOST` 与 `OPENCODE_SKIP_START=true` 连接 CodeArts 26.6.x 的
OpenCode-compatible headless server；OpenChamber 与 CodeArts 使用相互独立的数据目录。

采用的官方上游仓库为 `https://github.com/openchamber/openchamber.git`，当前固定提交为
[`f9ad0de3e5e7cf281dd4966391409f3e19de4e79`](https://github.com/openchamber/openchamber/commit/f9ad0de3e5e7cf281dd4966391409f3e19de4e79)（1.16.2）。
具体归属见 `apps/workbench/THIRD_PARTY_NOTICES.md`。

## 已验证兼容性（不是完整产品闭环）

2026-07-21 在 Windows 上使用原版 OpenChamber 1.16.2 和 CodeArts 26.6.2 完成只读验证：

- CodeArts `/global/health` 与 `/doc` 返回 200，GameForge MCP 为 `connected`；
- OpenChamber `/health` 报告 `openCodeRunning=true`、`isOpenCodeReady=true`；
- 原版浏览器 UI 读取 project、session、provider/model、agent、MCP、LSP、VCS、permission 与 command 接口；
- CodeArts 暴露 `huaweicloud-maas` 的四个模型和内置 Agent；
- 未创建 Session、未发送提示、未调用模型，也未修改 OpenChamber 上游源码。

以上只证明 OpenChamber 与 CodeArts 的只读兼容性。它不证明真实需求提交、GameForge Task/Run 创建、Phaser 项目生成、Chrome 验证或 GUI 证据投影已经完成。

## 当前目标闭环

```text
OpenChamber native Session
  -> CodeArts
  -> GameForge MCP create/claim/execute Task
  -> Relay Task/Run/Verification
  -> Phaser Web preview and Chrome verification
  -> OpenChamber GameForge adapter projection
```

OpenChamber Session 负责交互；Relay 仍是 GameForge Project、Task、Run 和验证的权威状态。两者不合并为同一种对象。

可选项目图标和不存在的 `.openchamber/openchamber.json` 会返回 404；这是原版的可选资源探测，不是 CodeArts API 不兼容。

## 接入边界

- `.third-party/openchamber` 是忽略的固定官方 checkout，不提交复制源码；
- `integrations/openchamber/` 只负责上游固定、启动、数据目录隔离和只读兼容探针；
- OpenChamber 继续使用自己的 `@opencode-ai/sdk` 和 Session UI，CodeArts 提供兼容 server；
- GameForge 后续扩展优先走 OpenChamber Runtime API、MCP、命令或插件，不在接入层实现第二套 Agent 循环；
- 现有 `apps/workbench` 暂时保留为内部 adapter、历史实现与 GameForge 专用状态投影，不是第二套产品 GUI；
- Electron、PTY、Git/SSH、tunnel 与移动端能力不因 Web GUI 接入自动获得 GameForge 授权。

## 验收

当前 Web MVP 的总门禁见 [Web Game MVP](./mvp-web-game.md)：

```powershell
bun run check
bun run test
bun run build
bun run workbench:smoke
```

在 `workbench:smoke` 真正覆盖 OpenChamber/GUI 入口前，现有 fixture smoke 只能记录为历史回归证据，不能记录为完整 MVP 闭环。

后续先盘点 OpenChamber 已有扩展接口，再决定如何接入 Manifest、生成计划、update diff、预览和脱敏 MCP Audit；不得在接口尚可复用时复制其布局或重写会话层。

本地 Workbench 不使用默认 `4173` 端口时，可为 Relay 显式增加安全来源：

```powershell
$env:GAMEFORGE_RUN_RELAY_ALLOWED_ORIGINS = "http://127.0.0.1:4177"
$env:GAMEFORGE_RUN_RELAY_PORT = "8788"
node packages/run-relay/dist/index.js
```

该配置拒绝带凭据、路径、query 或 fragment 的 URL，并只接受 HTTPS 或
loopback HTTP。未设置时仍使用 Relay 原有的 `4173` 默认来源。
