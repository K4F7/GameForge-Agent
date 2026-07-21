# GameForge 术语表

状态：accepted
日期：2026-07-21

## 核心对象

### Project

一个可长期创建和修改的 Web 游戏工程。一个 Project 可以关联多个 Task。修改已有 Project 时必须显式提供 `projectId`。

### OpenChamber Session

用户与 CodeArts 的交互会话。Session 可以产生多个 Task，但不是 GameForge 的权威项目记录，也不能替代 RunEvent 和验证证据。

### Task

一次明确、不可变的新建或修改请求。当前版本中，一个 Task 对应一个 Run。改变需求或失败后重新执行时创建新 Task，不修改旧 Task 历史。

### Run

Task 的一次权威执行及其连续事件序列。Run 必须通过显式终态事件结束，不能根据 Session idle、进程退出码或构建成功自行推断完成。

### Relay

Project 关联信息、Task、RunEvent、回放游标和验证摘要的权威状态服务。Relay 不调用模型，也不实现 Agent 循环。

### GameSpec

CodeArts、生成器、SimulationCore 和运行时适配器之间共享的引擎无关语义契约。它描述游戏目标、玩法类型、操作、胜负条件和有界参数，用于创建基线与验收输入。

GameSpec 不是 Phaser GameObject 序列化、完整关卡文件、源代码描述或后续修改的唯一来源。

### LevelSpec

未来用于描述地图、图层、实体、布局和关卡字段的独立规格。当前只保留概念，下一版本再参考 Tiled/LDtk 设计和实现。

### AssetManifest

已落盘运行时资产的清单，记录逻辑角色、路径、MIME、大小、SHA-256、来源和许可。它不属于 GameSpec，也不允许用 Prompt 猜测替换目标。

### Telemetry

运行时发布的可校验状态，例如结果、生命、分数、计时和实体位置。Telemetry 描述“实际发生了什么”，不描述“应该生成什么”。

### RuntimeAdapter

把 GameSpec 和项目代码映射到具体运行时的实现。当前唯一生产 RuntimeAdapter 是 Phaser Web 2D；平台适配器状态为 `paused`。

### Verification

针对明确 Project、Run 和目标行为执行的验证结果。构建、浏览器玩法、视觉和真实 CodeArts 闭环属于不同证据，不得互相替代。

### Target

生成项目的目标运行环境。当前产品只暴露 `web`。仓库内保留的 `douyin-mini-game` 和 `wechat-mini-game` 是暂停能力，不进入当前 GUI 或 MVP。

## 当前关系

```text
Project 1 -> N Task
Task    1 -> 1 Run
Session 1 -> N Task
Run     1 -> N RunEvent / Verification references
```

未来若需要同一 Task 多次权威执行，再引入 `attempt`，当前不得提前假设该能力存在。
