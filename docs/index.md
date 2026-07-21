# GameForge 文档入口

状态：accepted
创建日期：2026-07-21
更新日期：2026-07-21
当前版本：`0.1.0-alpha.1`

## 当前产品基线

GameForge 当前只推进 Web Game：CodeArts 是主智能体，Phaser Web 2D 是唯一生产运行时，OpenChamber 是唯一 GUI 与后续定制基线。抖音、微信、DevTool、外部 Provider 和专业角色委派均不属于当前版本。

权威入口：

- [ADR-0003：Web-first 与 OpenChamber 单一 GUI](./decisions/0003-web-first-openchamber.md)
- [Web Game PRD](./prd-web-game.md)
- [Web Game MVP](./mvp-web-game.md)
- [术语表](./glossary.md)
- [验收矩阵](./acceptance-matrix.md)
- [版本规范](./versioning.md)
- [路线图](./roadmap.md)

## 文档权威层级

| 文档类型 | 单一职责 |
|---|---|
| `AGENTS.md` | 稳定工程规则、安全边界和 Agent 行为 |
| ADR | 已接受的架构与产品边界决策 |
| PRD | 当前产品定义、用户问题和需求 |
| MVP | 当前实现范围、非目标和完成标准 |
| Roadmap | 未来顺序、状态和依赖关系 |
| Experiments | 实际执行环境、输入、证据和结论 |
| README | 项目入口、快速开始和当前状态摘要 |

README、roadmap 或历史实验不得覆盖已接受的 ADR，也不得把一次实验结果写成普遍产品能力。

## 状态枚举

- `draft`：尚未批准的草稿；
- `accepted`：已批准的决策或产品定义；
- `in-progress`：当前实施中；
- `validated`：已按声明的完成条件完成验证；
- `paused`：保留实现与证据，但暂停扩展和主动执行；
- `superseded`：已被新文档取代；
- `deprecated`：不再采用，且不应作为新实现依据。

## 暂停与历史文档

以下内容保留为研究成果和恢复入口，但当前不进入默认产品流程、GUI、MVP 或验收门禁：

- [ADR-0002：国内小游戏平台 V1](./decisions/0002-domestic-mini-game-v1.md)；
- [抖音小游戏 MVP 历史计划](./mvp-plan.md)；
- [国内小游戏平台调研](./domestic-mini-game-platforms.md)；
- [抖音 CLI 管线](./douyin-cli-pipeline.md)；
- [模型与媒体 Provider 策略](./model-media-strategy.md)。

以下专业角色文档已被当前 Web Game PRD/MVP 取代，其内容转入下一版本 TODO：

- [旧 Web 2D 专业 Agent GUI PRD](./prd-web2d-opencodegui.md)；
- [旧 Web 2D 专业 Agent GUI MVP](./mvp-web2d-opencodegui.md)。

## 下一版本最高优先级

下一版本首先执行文档目录与信息架构重排，然后依次评估外部 Provider、LevelSpec、专业角色契约和真实多 Agent 委派。当前版本不提前实现这些内容。
