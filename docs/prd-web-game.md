# GameForge Web Game PRD

状态：accepted
日期：2026-07-21
目标稳定发布线：`0.1.0`（当前 `0.1.0-alpha.1`）

## 产品定义

GameForge 是一个由 CodeArts 驱动、使用 Phaser Web 2D 生成和持续修改游戏、以 OpenChamber 作为唯一 GUI 的 AI 游戏工程系统。

用户在 OpenChamber 中提出新建或修改需求。CodeArts 负责理解、计划和修改工程；GameForge MCP 提供确定性生成、预览、验证和状态工具；Relay 保存可回放的 Task、Run 与证据；Chrome 提供真实浏览器玩法和视觉验证。

## 核心用户流程

```text
打开 OpenChamber
  -> 提交普通自然语言需求
  -> CodeArts 创建并执行 GameForge Task
  -> 新建或修改 Phaser Web 2D Project
  -> 构建并启动受控预览
  -> Chrome 执行真实输入与视觉验证
  -> OpenChamber 展示 Diff、预览、日志和证据
  -> 用户继续针对同一 Project 提交新的修改 Task
```

## 产品原则

- 单一主智能体：CodeArts 是 Task 的唯一负责人；
- 单一 GUI：产品只使用基于 OpenChamber 的 GameForge GUI；
- Web-first：当前唯一生产 target 是 `web`；
- 项目长期存在：Project 可被多个 Task 持续修改；
- 代码权威：创建后真实项目代码是后续修改的权威来源；
- 证据分离：构建、浏览器玩法、视觉和真实 CodeArts 闭环分别声明；
- 离线基线：当前版本不依赖外部 Provider、账号或平台工具；
- 上游优先：OpenChamber 定制优先使用 Runtime API、MCP、命令和插件扩展点。

## 功能需求

### FR-1 OpenChamber 与 CodeArts

- 原版 OpenChamber Web GUI 可以连接隔离数据目录中的 CodeArts headless server；
- 用户可以通过原生 Session 向 CodeArts 提交需求；
- GameForge adapter 可以在 OpenChamber 中展示 Relay 的 Project、Task、Run 和 Verification；
- GUI 不实现第二套 Agent 循环或任务状态机。

### FR-2 Web 项目创建与修改

- 新建 Task 不携带 `projectId`，系统创建新的 Phaser Web 2D Project；
- 修改 Task 必须显式携带 `projectId`；
- 创建后 CodeArts 可以直接修改 TypeScript、样式和测试；
- 生成器再次运行时保留已修改文件，冲突时拒绝覆盖；
- 一个 Project 可以连续关联多个不可变 Task。

### FR-3 玩法基线

- 支持 `arcade`、`platformer`、`puzzle`、`shooter` 和 `strategy` 五种稳定模板；
- `arcade` 提供首条真实端到端黄金任务；
- 没有外部素材和音频账号时仍可运行、验证和重开。

### FR-4 预览与证据

- 预览只绑定 loopback 随机端口，并使用受控 Vite 配置；
- Chrome 验证阻断外部网络，收集控制台、页面异常和失败请求；
- GUI 展示预览、Diff、日志、验证结果和相对证据引用；
- Session 结束、构建成功或 Canvas 出现均不得单独推断为 Run 完成。

## 非功能需求

- 业务代码使用严格 TypeScript；
- 文档和产品 UI 使用简体中文；
- GUI 不持有 CodeArts、Provider、Relay 或平台凭据；
- 核心契约保持客户端无关；
- OpenChamber 上游版本和本地差异必须可追踪、可回滚、可升级；
- 当前闭环必须能在无外部网络和媒体账号的干净环境复现。

## 成功指标

1. 一个真实 `arcade` Task 完成 OpenChamber、CodeArts、MCP、Phaser、Chrome 和 GUI 证据闭环；
2. 同一 Project 可以完成至少一次显式 `projectId` 修改任务；
3. 五种模板在 RC 前通过生成器和基础可玩性回归；
4. 合并门禁 `check`、`test`、`build`、`workbench:smoke` 全部通过；
5. 文档不再把平台、Provider、专业角色或只读兼容探针写成当前已完成能力。

## 非目标

- 抖音、微信、DevTool、真机或发布；
- 外部图片、音频、TTS 或模型 Provider；
- LevelSpec 或地图编辑器；
- `@专业角色` 和真实多 Agent 委派；
- 第二套自研 GUI；
- 生产级、平台可发布或商业上线声明。
