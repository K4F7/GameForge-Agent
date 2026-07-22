# GameForge Agent

基于华为云 CodeArts Agent 的复杂软件工程与游戏生产研究仓库。CodeArts 是主智能体；MCP、Relay、生成器、资产存储和浏览器验证保持确定性且客户端无关。

## 当前产品边界

仓库不再提供自建 TUI、Workbench 或桌面 GUI。以下三个历史入口已从 Git 删除：

- `apps/tui/`：旧 Bun RunEvent 客户端；
- `apps/workbench/`：旧 GameForge React 状态界面；
- `apps/desktop/`：只包装 Workbench 的 Tauri 壳。

UI 验收的两个对象是仓库外部的原版界面：CodeArts 原版交互式 TUI 与 OpenChamber 上游原版 GUI。`packages/ui-test-harness/` 是外置自动化控制层，不是第三套产品 UI，也不会修改两个被测对象。

## 目录

```text
├── .codeartsdoer/                 # CodeArts 工程上下文、Agent 与 Skills
├── apps/game/                     # Phaser + Vite 示例游戏
├── integrations/                  # CodeArts / OpenCode 隔离启动适配
├── packages/contracts/            # Schema 与客户端无关契约
├── packages/generator/            # 固定模板安全生成器
├── packages/asset-store/          # 资产落盘与 Manifest
├── packages/run-relay/            # Task、RunEvent 与恢复协议
├── packages/game-verifier/        # 真实 Chrome 游戏验证
├── packages/mcp-server/           # 确定性 MCP 工具边界
├── packages/ui-test-harness/      # 外置 TUI/GUI 自动验收框架
├── docs/                          # 架构、运行时与交接文档
└── experiments/                   # 脱敏实验记录
```

## 常用命令

```powershell
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run audit
bun run doctor
bun run doctor:browser
bun run bundle:check
bun run dev:local
```

`dev:local` 只启动 Relay、示例游戏和持久 Douyin Bridge Host，不启动任何 GUI。CodeArts 与独立 OpenCode 使用不同数据目录：

```powershell
bun run codearts
bun run opencode
```

## UI 自动验收

当前只交付可检查的框架契约，不提供运行命令，也不会自动启动测试会话。设计与剩余选择见：

- [外置测试框架设计](docs/ui-test-harness-design.md)
- [CodeArts / OpenChamber 验收交接](docs/codearts-live-acceptance-handoff-2026-07-22.md)
- [可见无人值守 Patch 要求](docs/codearts-visible-unattended-patch-requirements-2026-07-22.md)

框架计划支持：

- 真实 ConPTY 中的 CodeArts TUI 文本和枚举按键注入；
- 真实浏览器中的 OpenChamber 导航、点击、输入与按键；
- Task、Run、RunEvent 权威门禁；
- 综合 TUI 输出、RunEvent 和项目变化的活动看门狗；
- TUI、GUI、MCP Audit、浏览器诊断、截图和视频的关联证据。

完整原始会话只写入 `.gameforge-validation/` 等仓库忽略目录；提交到 `experiments/` 的记录必须脱敏。

## 安全边界

- 不提交密钥、令牌、账号、认证数据库或本机绝对路径。
- MCP 工具不得实现第二套 Agent 循环，也不得提供任意 shell。
- 未经明确授权，不部署、发布、删除远程资源或修改仓库权限。
- 当前禁止抖音小游戏 preview、上传、提审或发布。
- 外部媒体 Provider 适配器可以保留，但默认不配置、不调用外部账号。
- 真实 CodeArts 验收必须使用当前安装客户端和实际证据，不能以上游 OpenCode 行为代替。

## 文档入口

- [分层架构](docs/architecture-layers.md)
- [CodeArts 快速开始](docs/codearts-quickstart.md)
- [游戏生成运行时](docs/game-generation-runtime.md)
- [模型路由](docs/model-routing.md)
- [路线图](docs/roadmap.md)
- [开源参考](docs/open-source-references.md)

历史 `experiments/` 和 ADR 会保留当时已经存在的 Workbench、TUI 或桌面壳名称，它们是实验事实，不是当前运行入口。
