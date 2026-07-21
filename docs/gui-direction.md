# GameForge GUI 方向：基于 OpenChamber 适配

更新日期：2026-07-20

外部资料访问日期：2026-07-20

## 决策

自 2026-07-20 起，GameForge 后续 GUI 以 [OpenChamber](https://github.com/openchamber/openchamber) 作为前端代码与交互基线，不再只把 OpenCodeUI 当作视觉参考。2026-07-21 重新核验官方仓库后，当前固定基线为提交 [`f9ad0de3e5e7cf281dd4966391409f3e19de4e79`](https://github.com/openchamber/openchamber/commit/f9ad0de3e5e7cf281dd4966391409f3e19de4e79)（版本 1.16.2）；正式引入源码时必须记录实际采用的上游提交与本地差异。

OpenChamber 的根许可证为 [MIT](https://github.com/openchamber/openchamber/blob/main/LICENSE)，与 GameForge 当前许可证兼容。复制或修改其重要源码时，必须保留上游版权和许可文本，并单独审查实际引入依赖的许可证。

本次“作为基础”分两阶段实施。第一版优先原样运行固定版本的 OpenChamber Web GUI，通过其官方外部 OpenCode server 模式连接 CodeArts，不复制、不重画也不提前分叉上游 UI。后续 GameForge 能力优先使用 OpenChamber 已暴露的 Runtime API、MCP、命令和插件边界扩展；只有现有扩展点确实不足并完成差异审查后，才修改上游 UI。它不表示把 OpenCode 会话模型、Agent 循环或高权限本地能力变成 GameForge 核心。

## 2026-07-21 范围收敛：共享 Task 与 `@专业角色`

当前 GUI 迭代保持现有三栏 Workbench，不新增独立程序、美术、测试应用，也不要求先完成多页面专业工作台。用户在同一个“游戏需求”输入框中通过 `@策划`、`@程序员`、`@美术` 和 `@测试` 点名需要的专业分工；所有角色共享同一个 Project、Task、Run、Artifact 与 Verification 上下文。

首阶段只实现结构化角色意图和可见历史，不宣称多个 Agent 已并行运行。CodeArts 仍是 Task 负责人；专业委派、交接和并行合并必须在后续建立独立契约与证据，不能在 GUI 或 MCP 中偷偷增加第二套 Agent 循环。产品需求与 MVP 见 [Web 2D 与专业 Agent GUI PRD](./prd-web2d-opencodegui.md) 和 [Web 2D 专业 Agent GUI MVP](./mvp-web2d-opencodegui.md)。

## 上游基线

根据上游 [package.json](https://github.com/openchamber/openchamber/blob/main/package.json) 与 [Agent Guide](https://github.com/openchamber/openchamber/blob/main/AGENTS.md)，OpenChamber 当前是 Bun monorepo，主要包含：

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

## 多专业工作台交互原则

GameForge GUI 借鉴 DaVinci Resolve 的“页面工作流”，但不照搬节点图或视频时间线。GUI 面向同一个游戏项目提供多个可快速切换的专业工作台；切换页面表示切换当前工作的侧重点、工具密度和专业 Agent 上下文，而不是进入相互隔离的聊天会话。

未来候选页面模型仍可为：`总览 | 程序 | 美术 | 音频 | 剧情 | 测试 | 合规 | 构建`。当前 MVP 不启用这些独立页面；只有 `@专业角色`、共享状态和结构化交接稳定后，才评估是否需要拆分页面。

页面切换必须遵守以下原则：

- 保持项目、场景和当前选中对象不变。同一个 Boss、关卡、对话或素材在不同页面中显示其程序、视觉、音频、剧情、测试和合规视角；
- 工作台属于专业领域，Agent 是工作台中的助手，不能把 GUI 降级为多个 Agent 聊天标签；
- 每个页面可以使用不同的中央编辑面：程序侧重代码、Diff、运行画面和日志，美术侧重画布与版本对比，音频侧重波形、循环和事件触发，剧情侧重正文、设定和条件，测试侧重复现证据，合规侧重规则依据和风险项；
- 顶部项目/场景/对象上下文、底部页面切换和专业 Agent 面板保持稳定，让用户能够快速换页抠细节；
- 测试问题、合规发现和专业修改使用结构化交接对象，携带目标对象、证据、期望结果和关联影响；不得依赖复制聊天原文完成跨页面交接；
- 美术、音频和剧情修改默认形成候选版本或差异，未经显式确认不覆盖权威资产或文本；
- 测试 Agent 负责发现与复验，实施修改仍由对应专业工作台中的 CodeArts 流程完成；合规 Agent 只报告已检查范围、证据与剩余风险，不宣称绝对合规。

OpenChamber 适配时，应优先复用其共享布局、导航、Inspector、素材浏览和响应式组件来实现这些页面；OpenCode session/message 仍不得成为页面间共享上下文。跨页面共享状态应落在 GameForge 的 Project、Task、Run、Artifact、Finding 和 Verification 等客户端无关契约上。

## 实施顺序

1. 固定上游版本，完成源码、依赖许可证、安全面和构建体积清单；
2. 用忽略目录中的固定官方 checkout 运行原版 OpenChamber；GameForge 仓库只保存 bootstrap、serve 和 compatibility probe，不复制上游源码；
3. 通过 `OPENCODE_HOST` / `OPENCODE_SKIP_START` 把 OpenChamber 连接到隔离数据目录中的 CodeArts headless server，并验证 project、session、provider/model、agent、MCP 与实时事件接口；
4. 盘点 OpenChamber 已有 Runtime API、MCP、命令与插件扩展点，GameForge 新能力优先从这些边界接入；
5. 只有扩展点不足时才建立最小补丁层，并保持固定上游提交、差异清单和可重放升级流程；
6. 完成窄屏、键盘导航、触摸安全区、本地通知和断线恢复验证；桌面壳、PTY、Git/SSH、远程访问、Electron 或移动端均另立范围。

接入应按垂直切片进行，每个切片都保留可回滚路径。旧 Workbench 已在仓库外保存完整工作树与 Git bundle；在原版 OpenChamber 通过等价行为、恢复、安全和构建门禁前，不删除仓库内现有实现。

## 验收条件

- 仓库记录采用的 OpenChamber commit、被复制或改写的目录、上游 MIT 归属和依赖许可证结果；
- GUI 不依赖 OpenCode session schema 作为 GameForge 核心状态，不直接执行 Agent 输出或任意本地命令；
- 同一 Run 的 Web、TUI 和桌面壳投影一致，断线恢复后 sequence 连续；
- UI 不绕过现有显式 API/MCP 操作修改 Run 或项目文件；
- 浏览器 bundle、CSP、iframe origin、敏感信息和 Tauri capability 门禁继续通过；
- 对应 package 的类型检查、测试、生产构建和 Workbench 浏览器 smoke test 实际通过。

## 历史说明

2026-07-18 的方案曾以 [OpenCodeUI](https://github.com/lehhair/OpenCodeUI) 为交互参考，并因其 GPL-3.0-only 许可证选择完全独立实现。该结论对 OpenCodeUI 本身仍然有效，但已被本文件关于 MIT 许可 OpenChamber 的新基线决策取代；不得把两个上游仓库或许可证混为一谈。
