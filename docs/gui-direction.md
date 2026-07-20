# GameForge GUI 方向：基于 OpenChamber 适配

更新日期：2026-07-20

外部资料访问日期：2026-07-20

## 决策

自 2026-07-20 起，GameForge 后续 GUI 以 [OpenChamber](https://github.com/btriapitsyn/openchamber) 作为前端代码与交互基线，不再只把 OpenCodeUI 当作视觉参考。首个评估基线固定为提交 [`31b43fbde90d368c5d131ec52e761d888466d597`](https://github.com/btriapitsyn/openchamber/commit/31b43fbde90d368c5d131ec52e761d888466d597)；正式引入源码时必须记录实际采用的上游提交与本地差异。

OpenChamber 的根许可证为 [MIT](https://github.com/btriapitsyn/openchamber/blob/main/LICENSE)，与 GameForge 当前许可证兼容。复制或修改其重要源码时，必须保留上游版权和许可文本，并单独审查实际引入依赖的许可证。

本次“作为基础”表示优先复用和改造 OpenChamber 的共享 React UI、布局、主题、组件、状态组织与多运行时抽象。它不表示把 OpenCode 会话模型、Agent 循环或高权限本地能力变成 GameForge 核心。

## 上游基线

根据上游 [package.json](https://github.com/btriapitsyn/openchamber/blob/main/package.json) 与 [Agent Guide](https://github.com/btriapitsyn/openchamber/blob/main/AGENTS.md)，OpenChamber 当前是 Bun monorepo，主要包含：

- `packages/ui`：React 共享 UI、状态、同步与运行时契约；
- `packages/web`：浏览器界面、服务端与 CLI；
- `packages/electron`：Electron 桌面壳和特权边界；
- `packages/vscode`：VS Code Webview 与扩展宿主；
- `packages/mobile`：Capacitor iOS/Android 壳。

其前端栈包括 React、TypeScript、Vite、Tailwind、Zustand、Radix UI、CodeMirror 等，同时直接依赖 `@opencode-ai/sdk`。GameForge 可以采用前一组 UI 技术和组织方式，但必须替换 OpenCode 专属的数据访问、会话同步与权限模型。

## 适配边界

| OpenChamber 基础 | GameForge 适配 | 权威数据来源 |
|---|---|---|
| 项目/会话侧栏 | Task/Run 历史、筛选与当前认领状态 | Run Relay Task API |
| 消息与活动流 | 连续阶段时间线、CodeArts 日志摘要、规格与验收证据 | RunEvent + Workbench reducer |
| 文件树与 Diff | 受管项目 Manifest、生成计划与 update diff | Generator dry-run / Asset Store |
| 工具调用展示 | 脱敏 MCP Audit 的工具名、顺序、状态与耗时 | Audit record |
| 共享 UI、主题和响应式布局 | GameForge 品牌、中文文案、无障碍与触摸适配 | 本地 UI 配置 |
| Runtime API 抽象 | GameForge Relay/MCP adapter，不暴露 OpenCode session schema | `@gameforge/contracts` / `@gameforge/run-relay` |
| 完成通知 | `run.completed` / `run.stopped` 本地通知 | RunEvent 终态 |

以下 GameForge 边界必须保留：

- CodeArts 仍是主智能体；GUI 只做状态投影和显式用户控制，不实现第二套 Agent 规划、模型重试或自动修复循环；
- Task、RunEvent、Manifest 和 Audit record 仍是客户端无关的核心契约，不以 OpenCode session/message/todo 替换；
- 现有 `apps/workbench` reducer 与恢复式事件流在迁移期间继续作为行为基准；同一 Run 的 Web、TUI 和桌面投影必须一致；
- 不让 GUI 持有 CodeArts AK/SK、Provider 密钥、Relay token 或平台登录 session；
- OpenChamber 的 PTY、Git/SSH、远程 tunnel、文件系统和 Electron 特权桥不会随 UI 一并默认引入。任何此类能力都需要单独需求、最小权限设计和安全验证；
- 当前 Tauri 2 零 IPC 桌面壳继续保留。是否切换到 OpenChamber 的 Electron 壳属于独立架构决策，不能由前端迁移自动带入；
- 当前不得在 GUI 中加入抖音小游戏 preview、上传、提审或发布。

## 实施顺序

1. 固定上游版本，完成源码、依赖许可证、安全面和构建体积清单；
2. 确定引入方式：优先把所需 OpenChamber UI 层迁入或适配到 `apps/workbench`，避免同时长期维护两套 GUI；
3. 先建立 GameForge Runtime API adapter，把 OpenChamber 的 OpenCode SDK、session store 和同步层替换为 Relay/RunEvent/reducer；
4. 迁移共享布局、主题、导航、时间线、证据面板、文件树与 Diff，保持现有 API 行为不变；
5. 完成窄屏、键盘导航、触摸安全区、本地通知和断线恢复验证；
6. 最后验证 Tauri Windows/macOS/Linux。PTY、Git/SSH、远程访问、Electron 或移动端均另立范围，不随基础迁移默认实施。

迁移应按垂直切片进行，每个切片都保留可回滚路径。旧 Workbench 只有在新界面通过等价行为、恢复、安全和构建门禁后才能删除。

## 验收条件

- 仓库记录采用的 OpenChamber commit、被复制或改写的目录、上游 MIT 归属和依赖许可证结果；
- GUI 不依赖 OpenCode session schema 作为 GameForge 核心状态，不直接执行 Agent 输出或任意本地命令；
- 同一 Run 的 Web、TUI 和桌面壳投影一致，断线恢复后 sequence 连续；
- UI 不绕过现有显式 API/MCP 操作修改 Run 或项目文件；
- 浏览器 bundle、CSP、iframe origin、敏感信息和 Tauri capability 门禁继续通过；
- 对应 package 的类型检查、测试、生产构建和 Workbench 浏览器 smoke test 实际通过。

## 历史说明

2026-07-18 的方案曾以 [OpenCodeUI](https://github.com/lehhair/OpenCodeUI) 为交互参考，并因其 GPL-3.0-only 许可证选择完全独立实现。该结论对 OpenCodeUI 本身仍然有效，但已被本文件关于 MIT 许可 OpenChamber 的新基线决策取代；不得把两个上游仓库或许可证混为一谈。
