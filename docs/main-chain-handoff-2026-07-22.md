# CodeArts 与 OpenChamber 游戏生产主链路交接

更新日期：2026-07-22

## 目标

先用 CodeArts 原版交互式 CLI/TUI，从一条用户级自然语言需求出发，独立完成一款中低复杂度 Phaser Web 2D 游戏的规划、程序、美术、剧情、浏览器验收、Bug 修复和附加需求；再用 OpenChamber 在全新输出目录中完成等价的新 Run。

这轮只使用 CodeArts 当前账号实际列出的内置模型，不调用百炼、Seedream、Freesound、豆包 TTS、MiniMax 或其他外部 Provider。旧 `apps/tui`、`apps/workbench` 与 `apps/desktop` 已从仓库删除，不再作为内部诊断、adapter 或行为基线。

## 已锁定的决策

- 基准游戏：2D 俯视角短篇动作冒险《星火遗迹》，正常游玩约 5–10 分钟。
- CodeArts 阶段使用原版交互式 TUI；非交互命令只允许做最小连通性探针。
- OpenChamber 阶段必须使用全新 Run 和全新输出目录，不复用 CodeArts 阶段的游戏产物充当成功证据。
- 模型角色：GLM-5.1 主编排与工具调用；GLM-4.7 ArkTS 编码与 Bug 修复；DeepSeek V3.2 剧情、对白与附加需求理解；GLM-5 独立复核。实际模型 ID 必须以本次 `codearts models` 输出为准；任一角色失败时先记录，不得静默切换。
- 人工只输入初始需求、Bug 的用户可见症状、附加需求，以及批准明确的安全权限。不得告诉 Agent 根因、文件位置或修改方案，不得人工替 Agent 修改游戏代码。
- 每个失败场景最多允许三个自主修复回合。三回合后停止追加提示，进入归因。
- 先跑未经修改的仓库基线。只有获得真实失败证据后，才能修改 Agent、Skill、系统提示词、模型路由、MCP 工具描述、状态反馈或验收设施。

## 游戏基准

《星火遗迹》至少包含：

- 标题、开场剧情、任务对话、探索战斗、Boss、胜利与失败结算；
- 玩家移动、冲刺和近战攻击；
- 两种普通敌人、一个简化 Boss、一个任务 NPC；
- 收集遗迹核心并开启出口的主任务；
- 生命值、任务状态、冷却或行动反馈；
- 统一像素风格、固定色板和清晰轮廓；
- Phaser/Canvas/SVG 生成的程序化素材与静音回退；
- 确定性地图与敌人布局，不依赖随机数才能走通验收；
- `window.__GAMEFORGE_TEST__` 兼容状态，能够报告 running/won/lost、生命、得分、任务进度和必要 telemetry。

美术门槛：玩家、普通敌人、Boss、NPC、核心和出口能够立即区分；移动、攻击、受击、死亡、技能释放有明确反馈；HUD 不遮挡玩法；无素材缺失、拉伸、闪烁、错层和透明边缘问题。

剧情门槛：开场交代目标和危机；NPC 对话承担任务叙事；收集、Boss 和结局均有状态一致的文本反馈；中文短而完整；无变量占位符、前后矛盾和状态错乱。

## 固定修复场景

基线游戏通过后，由测试方注入一个 CodeArts 事先不知道的确定性缺陷：Boss 已被击败，但出口仍保持锁定，玩家无法进入胜利结算。

只向 CodeArts 提交以下症状，不透露根因：

> 我击败了 Boss，但遗迹出口仍然显示锁定，无法进入胜利结算。请自行复现、定位并修复；修复后重新执行完整回归，确认收集任务、普通战斗、失败结算和胜利结算都没有退化。

受控故障注入属于测试准备，不计为人工替 Agent 修复。应保存注入前后的最小 diff，但不要在 CodeArts 修复前把 diff 或根因放入会话上下文。

## 固定附加需求

Bug 修复通过后，在同一 CodeArts 会话中提交：

> 请为《星火遗迹》新增“能量冲击”技能：玩家收集 3 个能量碎片后解锁；按一个清晰提示的按键释放远程攻击；HUD 显示解锁状态和冷却；NPC 对话与任务提示同步更新；技能能够伤害敌人，但不能穿墙。请自行完成程序、美术反馈和剧情文本，并执行完整回归，确保原有移动、冲刺、近战、Boss、胜负条件和任务流程没有退化。

## 必须独立通过的证据门禁

- TypeScript 严格检查、相关单元测试和生产构建通过。
- 浏览器自动化走通标题、剧情、任务、普通战斗、Boss、失败与胜利；附加需求后再覆盖技能解锁、冷却、伤害和阻挡。
- 浏览器控制台错误、页面错误、失败请求和资源缺失均为零；若存在已知预期中断，必须精确列入 allowlist 并解释。
- 游戏提供确定性、受限的测试状态；不得用测试接口直接伪造胜利代替实际玩法路径。
- 保存关键截图并复核布局、美术一致性和中文剧情。
- 生成 Agent 的“已完成”声明不是证据。必须以构建产物、浏览器报告、RunEvent 和 MCP 审计为准。
- 同一个 Task/Run 的事件必须连续，并覆盖认领、能力、规格、生成、验证、预览和终态；缺失事件或 cursor 不连续即失败。

## 失败归因

只有同时满足以下条件，才允许标记为“模型能力限制，暂不处理”：

1. 工具、契约、权限、上下文注入和事件链正常；
2. 用户需求、Skill 与系统提示不存在歧义或冲突；
3. 在两个全新会话中重复失败；
4. 换用当前 CodeArts 内另一实际可用模型仍无法完成；
5. 证据明确指向推理或生成质量，而不是漏调用工具、错误路由、上下文丢失、提前停止或虚报完成。

否则，失败属于本轮要处理的 GameForge 问题，包括 Agent 流程、Skill、系统提示、任务模板、模型路由、MCP 工具描述、状态反馈、重试和验收机制。

## 实施顺序

### 阶段 0：只读建档与基线准备

1. 阅读下方“必读文件”。
2. 检查工作树，保留用户已有的未跟踪目录，不提交或删除 `.playwright-mcp/`、`openchamber_probe2/`、`opencode_probe_20260721/`。
3. 运行 `codearts models` 或仓库约定的等价只读探针，记录本次真实模型列表，不输出认证信息。
4. 为本次实验创建独立的 Task ID、Run ID、状态文件和 `.gameforge-validation` 子目录。
5. 运行仓库已有的安装、构建和 doctor 基线；不要先修改代码。

### 阶段 1：CodeArts 原版主链路

1. 通过 `bun run codearts` 启动隔离数据目录的 CodeArts 原版交互式 TUI。
2. 注入下方“CodeArts 初始任务提示词”。
3. 允许正常的 ask 权限确认，记录每次人工确认。
4. 观察 CodeArts 是否自主创建/认领 Task、绑定审计、生成 GameSpec、生成项目、构建、运行浏览器验收、发布连续 RunEvent、预览并完成 Run。
5. 如果它像既有实验一样在生成后停止，不要立刻提示“继续”。先保存停顿证据，判断是系统提示、Skill、工具反馈还是模型行为；“需要用户提醒继续”本身是基线失败。
6. 按真实证据做最小修复，并在全新会话、全新 Run 中从初始提示重新测试。
7. 基线通过后执行固定 Bug 场景，再执行固定附加需求；每次修改后全量回归。

### 阶段 2：OpenChamber 等价主链路

当前仓库只建立了外置 UI 测试框架契约，尚未实现或证明真实 OpenChamber 浏览器适配器。CodeArts TUI 使用唯一 ConPTY 和独立 xterm 观察窗；OpenChamber 保持另一个原版 GUI 窗口。不得把历史 Workbench 证据当成 OpenChamber 成功。

1. 先确认 OpenChamber 固定版本、许可证与启动方式，不依赖未跟踪 probe 目录作为产品源码。
2. 补齐或验证：创建真实 CodeArts 会话、提交多轮 Prompt、权限交互、工具调用展示、Task/Run 状态、MCP 脱敏审计和终态。
3. 在全新输出目录中重复 CodeArts 阶段的初始任务、Bug 症状和附加需求。
4. OpenChamber 不得实现自己的 Agent 循环；它是 GUI/Session 面，CodeArts 仍是唯一主智能体。

### 阶段 3：回归与记录

运行与改动风险相称的 focused tests，然后执行仓库全量 `check`、`test`、`build`、bundle、doctor、浏览器验收和 `git diff --check`。记录实际命令和结果，不得凭日志片段声称通过。

每个阶段保存：初始任务、实际模型 ID、角色路由、耗时、MCP 调用摘要、连续 RunEvent、人工干预、构建/浏览器报告、关键截图、失败归因、修复 diff 和全新会话复测结果。不得保存凭据、完整私聊、绝对本机路径、原始思维过程或 Provider 私有响应。

## CodeArts 初始任务提示词

下面的内容应作为用户级需求注入真实 CodeArts 原版会话。不要在提示词中补充具体工具调用顺序或文件位置；这些应由系统提示、Skill 和 Agent 自己解决。

> 请从零制作一款名为《星火遗迹》的 Phaser Web 2D 俯视角短篇动作冒险游戏，并完成可验证的本地交付。
>
> 游戏应在 5–10 分钟内通关，包含标题、开场剧情、任务 NPC、探索与战斗、Boss、胜利和失败结算。玩家能够移动、冲刺和近战攻击；游戏包含两种普通敌人、一个简化 Boss，以及“收集遗迹核心并开启出口”的主任务。需要清晰的生命值、任务状态和操作反馈。
>
> 美术采用统一像素风、固定色板和清晰轮廓。玩家、敌人、Boss、NPC、核心和出口必须容易区分；移动、攻击、受击、死亡和任务完成要有明确视觉反馈；HUD 不得遮挡核心玩法。剧情使用简体中文，开场要解释目标与危机，NPC 对话、收集进度、Boss 战和结局文本必须与实际游戏状态一致。
>
> 本次只能使用当前 CodeArts 宿主实际提供的内置模型。主编排使用 GLM-5.1，编码与修复使用 GLM-4.7 ArkTS，剧情与对白使用 DeepSeek V3.2，独立复核使用 GLM-5；精确模型 ID 以本次宿主列表为准，不得静默改用外部模型。不要调用百炼、Seedream、Freesound、豆包 TTS、MiniMax 或任何其他外部 Provider；素材使用 Phaser、Canvas、SVG 等程序化方式，音频使用静音回退。
>
> 请自行完成任务创建与认领、规格校验、项目生成、构建、浏览器玩法验收、错误修复、预览和 Run 终态记录。游戏必须提供受限且确定性的 `window.__GAMEFORGE_TEST__` 状态，使自动化能够验证 running、won、lost、生命、任务进度和必要 telemetry，但不得用测试接口伪造胜利代替实际玩法路径。请分别验证可达的胜利和失败流程，并检查控制台错误、页面错误、失败请求和资源缺失。
>
> 不要执行部署、远程发布、抖音 preview、上传、提审或发布。不要在未完成浏览器和构建证据时声称成功。如果遇到阻碍，请给出明确证据并继续处理所有仍可安全推进的步骤。

## 给干净工程 Agent 的总提示词

> 你在本仓库根目录中工作。先完整阅读根 `AGENTS.md` 和 `docs/main-chain-handoff-2026-07-22.md`，严格遵循其中的子代理、CodeArts、安全和验证规则。
>
> 目标不是立即补功能，而是先用未经修改的当前基线，在真实 CodeArts 原版交互式 TUI 中完成《星火遗迹》主链路实验；获得失败证据后，才对 Agent、Skill、系统提示词、模型路由、MCP 工具描述、状态反馈或验收设施做最小修复，并用全新会话重测。CodeArts 阶段稳定后，再通过 OpenChamber 用全新 Run 和全新输出目录完成等价实验。
>
> 旧 `apps/tui`、`apps/workbench` 和 `apps/desktop` 已删除；OpenChamber 是唯一 GUI 被测对象，CodeArts 原版 TUI 是唯一 TUI 被测对象，CodeArts 是唯一主智能体。不要调用任何外部 Provider，不要部署或执行抖音 preview/上传/发布。保留用户已有未跟踪目录，不要提交凭据、本机绝对路径或私有会话数据。
>
> 先给出简短计划和验收条件，再执行。过程中记录真实模型、耗时、工具调用、人工干预、RunEvent、构建和浏览器证据。每个失败场景最多三个自主修复回合；不能把需要“继续”的人工提醒、虚报完成或工具漏调用归为模型限制。最后汇报修改文件、实际运行命令、结果和剩余风险。

## 必读文件

按此顺序阅读；奠基性文档由主 Agent 自己完整阅读，不外包给子代理：

1. `AGENTS.md`
2. `docs/architecture-layers.md`
3. `docs/roadmap.md`
4. `docs/codearts-quickstart.md`
5. `docs/game-generation-runtime.md`
6. `docs/model-media-strategy.md`
7. `docs/ui-test-harness-design.md`
8. `docs/codearts-live-acceptance-handoff-2026-07-22.md`
9. `.codeartsdoer/skills/gameforge-build/SKILL.md`
10. `config/model-routing.example.json`
11. `integrations/codearts/launch.ts`
12. `packages/mcp-server/src/server.ts`
13. `packages/mcp-server/src/tools.ts`
14. `packages/game-verifier/src/verifier.ts`
15. `packages/generator/src/template.ts`
16. `packages/contracts/src/run-events.ts`
17. `packages/ui-test-harness/src/contracts.ts`
18. `packages/ui-test-harness/src/controller.ts`
19. `packages/ui-test-harness/src/watchdog.ts`
20. `experiments/2026-07-18-codearts-real-e2e/task.md`
21. `experiments/2026-07-18-codearts-real-e2e/result.md`
22. `experiments/2026-07-18-codearts-headless-task-create/result.md`
23. `experiments/2026-07-18-codearts-noninteractive-recheck/result.md`
24. `experiments/2026-07-18-codearts-douyin-full/result.md`

## 已知事实，开始前必须复核

- `bun run codearts` 通过 `integrations/codearts/launch.ts` 使用隔离的 CodeArts 数据与配置目录启动原版 TUI；不得与独立 OpenCode 共用数据库。
- OAuth TUI 登录不能自动证明非交互 `codearts run` 可用；非交互模式可能需要单独的 `CODEARTS_CLI_AK/SK`，不得打印或提交这些值。
- 既有真实 CodeArts E2E 曾发布六个连续事件并完成 Run，但在生成后停顿，依赖用户追加“继续完成 preview/verification/complete”。本轮要把这种停顿作为需要归因的失败，而不是可接受人工步骤。
- `verify_game_project` 能用受管 Vite 与 Playwright 执行动作、读取 `window.__GAMEFORGE_TEST__`、截图并收集 console/page/request failures；它不会替 Agent 修复，也不替代真实玩法设计。
- verifier 目前主要执行固定动作脚本，没有自适应寻路或内建多场景回归套件。《星火遗迹》必须保持确定性，必要时补最小的多场景验收设施。
- OpenChamber 具体浏览器适配器尚未实现；当前框架只固定了独立 xterm/同一 ConPTY、独立 OpenChamber 窗口和权威状态门禁。后续必须用真实适配器证明，不能用历史 Workbench smoke 冒充产品闭环。
