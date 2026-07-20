# GameForge GUI 方向：参考 OpenCodeUI，独立实现

更新日期：2026-07-18

外部资料访问日期：2026-07-18

## 决策

第二轮 GUI 继续复用现有 React Workbench、Run Relay、共享 reducer 与 Tauri 2 最小权限壳。用户指定 [OpenCodeUI](https://github.com/lehhair/OpenCodeUI) 作为交互参考，但 GameForge 不复制它的源码、组件或样式实现，也不依赖 OpenCode SDK。

原因有两点：

1. OpenCodeUI 是面向 `opencode serve` 的第三方 Web 前端。根据其 OpenCode SDK 依赖以及 SSE、PTY、文件和会话 API 结构，GameForge 将其判断为与 OpenCode 后端强绑定；这是架构判断，不是上游 README 的原句；
2. 上游 `package.json` 声明 [`GPL-3.0-only`](https://github.com/lehhair/OpenCodeUI/blob/main/LICENSE)，GameForge 当前为 MIT 项目。未经单独许可证评估，不把上游代码混入仓库。

“参考”只表示借鉴公开可见的布局和交互模式，所有 GameForge 代码都从现有 contracts/Relay API 独立设计与实现。

## 可借鉴的交互

OpenCodeUI 的 [README](https://github.com/lehhair/OpenCodeUI/blob/main/README.md) 展示了聊天消息流、Markdown/代码高亮、xterm.js 终端、文件浏览与多文件 Diff、主题、PWA、移动端适配、通知、`@` 提及、斜杠命令和 Tauri 2 桌面壳。其 [package.json](https://github.com/lehhair/OpenCodeUI/blob/main/package.json) 使用 React、TypeScript、Vite、Tailwind、Shiki、xterm.js 与 Tauri。

GameForge 的对应设计如下：

| OpenCodeUI 交互 | GameForge 独立实现 | 数据权威来源 |
|---|---|---|
| 左侧会话列表 | Task/Run 历史、筛选与当前认领状态 | Run Relay Task API |
| 中央消息流 | 阶段时间线、CodeArts 日志摘要、规格与游戏预览 | 连续 RunEvent + Workbench reducer |
| 右侧文件/Diff | 受管项目 Manifest、生成计划与 update diff | Generator dry-run / Asset Store |
| 工具调用展示 | MCP Audit 的工具名、顺序、状态和耗时摘要 | 脱敏 Audit record |
| 内置终端 | 后续可选的显式 Bun 命令会话，不自动执行 Agent 输出 | 用户确认的本地进程 |
| `/` 命令 | `submit`、`follow`、`stop`、`status` 等已有 TUI 动作 | 共享 Relay Client |
| 完成通知 | `run.completed` / `run.stopped` 本地通知 | RunEvent 终态 |
| Tauri/PWA | 继续强化现有零 IPC Tauri 壳与响应式 Workbench | `apps/desktop` / `apps/workbench` |

## 不复制的部分

- 不引入 `@opencode-ai/sdk`，不把 OpenCode session/message/todo 当作 GameForge 核心契约；
- 不在 GUI 中实现 Agent 规划、模型重试、自动修复或第二套工具循环；
- 不直接开放任意工作区文件和 PTY。若以后增加，必须限制到受管项目、显式用户动作和可审计命令；
- 不让 GUI 持有 CodeArts AK/SK、Provider 密钥、Relay token 或平台登录 session；
- 不把平台 preview、上传、提审或发布放进 GUI 当前范围。

## 实施顺序

1. 在现有 Workbench 中加入 Task/Run 三栏导航与可折叠证据面板；
2. 复用 reducer 显示 MCP Audit 摘要、生成计划和受管文件 Diff，不新增后端 Agent；
3. 完成窄屏、触摸安全区、键盘导航和主题变量；
4. 评估本地完成通知；
5. 只有在权限模型、命令 allowlist 和进程清理测试完成后，再决定是否增加受限终端；
6. 最后验证 Tauri Windows/macOS/Linux，不在此阶段设计安装包发布。

## 验收条件

- 同一 Run 的 Web、TUI 和桌面壳投影一致，断线恢复后 sequence 连续；
- UI 不直接修改 Run 或项目文件，所有变更来自现有显式 API/MCP 操作；
- 浏览器 bundle、CSP、iframe origin 和 Tauri capability 门禁继续通过；
- 仓库依赖和新增源码不包含 OpenCodeUI GPL 代码；
- 桌面壳不获得不必要的文件、shell、网络或更新权限。
