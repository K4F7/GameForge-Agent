# GameForge Web 2D 与专业 Agent GUI PRD（已取代）

状态：superseded
日期：2026-07-21
产品中心：Web 2D + 单一 OpenCode 风格 GUI

当前权威文档是 [Web Game PRD](./prd-web-game.md)。本文件保留专业角色和未来 GUI 研究，不作为 `0.1.0-alpha.1` 的当前范围依据；专业角色、Provider、LevelSpec 和多 Agent 委派进入下一版本 TODO。

## 产品定义

GameForge 是一个以 CodeArts 为主智能体、以 Phaser Web 2D 为默认生成运行时、以现有 Workbench/OpenChamber 适配界面为统一操作入口的 AI 游戏工程系统。

用户不需要进入 Cocos Creator、LayaAir IDE 或额外的专业编辑器来完成日常工作。需求、专业分工、运行进度、游戏预览、差异、资产候选和验证证据尽量集中在同一个 GUI 与同一个 Project/Task/Run 上下文中。平台引擎或开发者工具只作为可选导出和最终平台验收边界，不成为产品中心。

## 用户问题

1. 带 GUI 的外部引擎难以被不同 AI 客户端稳定连接、读取和控制。
2. 多个独立专业页面或聊天会话会切断项目、场景、对象和证据上下文。
3. 纯聊天无法明确表达“谁负责修复代码、谁负责修改图片、谁负责复验”。
4. 自动委派若不可见，会让用户无法判断职责、权限、产物和失败位置。
5. GUI 若重新实现 Agent 循环，会破坏 CodeArts、MCP、Relay 和 RunEvent 的既有边界。

## 产品原则

- 单一 GUI：Web Workbench 与 Tauri 桌面壳复用同一 React 构建，不维护第二套前端。
- 单一上下文：同一 Project、Task、Run、Artifact、Finding 和 Verification 在所有专业角色间共享。
- 显式分工：用户通过 `@角色` 指定需要的专业能力；系统保存结构化角色意图。
- CodeArts 负责：CodeArts 仍是 Task 的权威负责人，GUI 和 MCP 不实现第二套 Agent 规划循环。
- 候选优先：美术、音频、剧情和规格修改默认形成候选或 Diff，未经确认不覆盖权威内容。
- 证据分离：浏览器视觉、逻辑、构建、平台工具和人工验收不得互相冒充。
- Web 2D 优先：Phaser、TypeScript、Vite、程序化素材和浏览器验证是默认生产路径。

## 核心交互

用户在现有“游戏需求”输入框中直接点名专业角色：

```text
@程序员 修复玩家与墙体高速移动时偶发穿透的问题，并补回归测试。

@美术 这张角色图的轮廓不清楚，请提供三个更适合深色背景的候选版本。

@策划 调整本关节奏；@程序员 按确认后的数值实现；@测试 独立复验胜负路径。
```
GUI 提供角色快捷按钮，并将识别结果保存为 Task 的 `requestedSpecialists`。原始 Prompt 仍完整保留，结构化字段只表达责任意图，不替代具体需求。

## 首批专业角色

| 提及 | 稳定标识 | 职责 | 默认权限边界 |
|---|---|---|---|
| `@策划` | `planner` | 玩法、规则、数值、GameSpec 和验收条件 | 形成结构化候选，不直接发布平台内容 |
| `@程序员` | `programmer` | 功能实现、Bug 修复、测试和构建 | 通过受管仓库与确定性工具修改代码 |
| `@美术` | `artist` | 图片诊断、视觉方向和候选资产 | 不覆盖权威素材，不默认调用外部账号 |
| `@测试` | `tester` | 复现、证据检查、浏览器 QA 和独立复验 | 默认只读发现；修复交回程序员或对应角色 |

音频、剧情、合规和构建角色待首批交接契约稳定后再增加，不在首个 MVP 中一次性铺开。

## 角色执行层级

### 层级 A：纯文本提及

`@角色` 仅保留在 Prompt 中，由模型自行理解。实现最便宜，但无法稳定校验、持久化、审计或参与 Run ID 幂等判断。

### 层级 B：结构化角色意图

GUI 解析 `@角色`，Task 同时保存规范化 `requestedSpecialists`。Relay、MCP 和历史视图能看到同一角色集合；相同 Run ID 改变角色集合会被判定为冲突。

这是当前采用方案。它建立可靠交互与数据基础，但不声称已经启动多个并行 Agent。

### 层级 C：专业 Agent 委派与交接

CodeArts 或宿主按 `requestedSpecialists` 委派专业子任务，使用结构化交接对象记录目标对象、指令、证据、候选产物、期望结果和复验状态。并行修改还必须解决权限、文件冲突、资产覆盖和合并顺序。

该层级是后续能力，不在 MCP 工具内部实现 Agent 循环。

## GUI 信息架构

当前三栏布局保持不动：

- 左栏：需求、`@角色`、语言、Task/Run 历史、GameSpec 和资产清单；
- 中央：Web 游戏预览、场景投影、地图投影与运行日志；
- 右栏：Run 进度、阶段、构建、浏览器验证和逻辑验证证据。

多专业工作台页面模型暂不启用。专业分工先通过同一输入框、同一 Task、同一活动流和同一 Inspector 表达，避免为每个角色建立新的 GUI、路由或聊天会话。

## 功能需求

### FR-1 角色提及

- GUI 展示首批四个 `@角色` 快捷按钮。
- 点击按钮把完整提及加入需求文本，已存在时不得重复添加。
- 用户可以直接键入提及；GUI 必须识别合法边界，不能把 `@程序员助手` 误识别为 `@程序员`。
- 连接中的任务输入与角色按钮保持一致锁定。

### FR-2 Task 契约

- Task 创建请求和持久化对象包含可选、有限、去重、稳定排序的 `requestedSpecialists`。
- 旧 Task 和旧持久化文件缺少字段时按空集合读取。
- 同一 Run ID 的幂等重试必须同时比较 Prompt、语言、项目和角色集合。
- 未知角色必须被严格 Schema 拒绝。

### FR-3 历史与可见性

- Task 历史显示已请求的 `@角色`。
- 载入历史 Task 后保留原始 Prompt，并恢复角色识别状态。
- GUI 不把“请求角色”显示成“角色已经执行完成”。

### FR-4 专业交接

- 后续专业委派必须使用客户端无关的结构化对象，而不是复制聊天原文。
- 交接至少包含 Project/Task/Run、目标对象、请求角色、指令、输入证据、候选产物、期望结果和状态。
- 测试发现交回程序员修复时，原 Finding 和复验证据必须可追溯。

### FR-5 Web 2D 主流程

- 默认生成运行时保持 Phaser + TypeScript + Vite。
- 游戏规则保持在可序列化、可验证的状态边界，Scene 不成为唯一事实来源。
- Web 预览、Chrome 输入回放、截图和诊断是主要质量证据。
- 平台导出不得反向要求日常工作依赖平台 GUI。

## 非功能需求

- 文档和 UI 使用简体中文，代码标识符使用英文。
- 角色集合最多四项，并保持稳定规范化顺序。
- GUI 不持有 CodeArts、Provider、Relay 或平台凭据。
- 不新增 PTY、Git/SSH、Tunnel、任意命令执行或高权限桌面桥。
- 不降低现有 CSP、iframe sandbox、origin allowlist、断线恢复和 RunEvent sequence 门禁。
- Workbench Web 与 Tauri 桌面壳显示相同状态。

## 成功指标

1. 用户可在现有 GUI 内完成需求输入、角色点名、Task 提交、预览和证据查看。
2. 角色元数据在 Workbench、Relay、MCP 和持久化恢复后保持一致。
3. 一个 `@程序员` Web 2D Bug 修复任务由真实 CodeArts 完成并通过浏览器回归。
4. 一个 `@美术` 任务产生可比较的候选图或明确修改说明，且不覆盖权威素材。
5. GUI 迁移不新增独立专业应用或第二套 Agent 循环。

## 非目标

- 在首版同时实现全部专业角色；
- 在 GUI 中实现自动规划、模型重试或自主修复循环；
- 保证多个专业 Agent 真正并行执行；
- 建立 Cocos Creator、LayaAir IDE 或其他编辑器桥；
- 默认启用外部媒体账号、广告、支付、分享或发布；
- 新增多页面专业编辑器、节点图、时间线或完整 IDE。

## 验证

```powershell
bun run --filter @gameforge/contracts check
bun run --filter @gameforge/contracts test
bun run --filter @gameforge/run-relay check
bun run --filter @gameforge/run-relay test
bun run --filter @gameforge/workbench check
bun run --filter @gameforge/workbench test
bun run --filter @gameforge/workbench build
bun run workbench:smoke
```
