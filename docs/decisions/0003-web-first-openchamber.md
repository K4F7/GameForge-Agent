# ADR-0003：Web-first 与 OpenChamber 单一 GUI

状态：accepted
日期：2026-07-21
当前版本：`0.1.0-alpha.1`
取代范围：ADR-0002 中关于“当前产品中心与默认生产目标”的部分

## 决策

GameForge 当前产品中心固定为：

- CodeArts 是唯一主智能体；
- Phaser Web 2D 是当前唯一生产运行时；
- OpenChamber 是唯一 GUI、交互方式和后续定制基线；
- `web` 是当前唯一对外生产 target；
- 抖音、微信、DevTool 和其他平台后端保留实现与历史证据，但状态为 `paused`；
- 外部图片、音频、TTS 和模型 Provider 保留适配器，但状态为 `paused`；
- `@专业角色`、Specialist Request、Finding、Handoff 和真实多 Agent 委派转入下一版本 TODO。

仓库内部可以暂时保留 `apps/workbench` 目录名，但它不是第二套产品 GUI。产品和文档统一称为“基于 OpenChamber 的 GameForge GUI”。

## 当前权威闭环

```text
OpenChamber Session
  -> CodeArts
  -> GameForge MCP
  -> Project / Task / Run / Relay
  -> Phaser Web 2D project
  -> Chrome verification
  -> OpenChamber preview / logs / evidence
```

OpenChamber 原生 Session 负责用户输入、CodeArts 对话和 Agent 交互。GameForge adapter 负责读取 Relay 的 Task、Run、Project 和 Verification。OpenChamber 不实现第二套任务状态机，Session 历史也不替代 Relay 的权威证据。

## 项目修改

生成器负责建立确定性项目基线。创建后，CodeArts 可以直接修改 TypeScript、样式和测试；后续修改不要求全部反写为 GameSpec。生成器更新必须保留已修改文件，发现冲突时停止，禁止静默覆盖。

修改已有游戏的 Task 必须显式携带 `projectId`。系统不得根据目录、最近 Session 或 Prompt 猜测目标项目。

## 当前玩法范围

保留 `arcade`、`platformer`、`puzzle`、`shooter` 和 `strategy` 五种 Phaser Web 模板。`arcade` 是第一条强制端到端黄金样例；其他四种在进入 RC 前完成生成器与基础可玩性回归。

## 非目标

- 平台导出、DevTool、真机、上传、提审或发布；
- 外部 Provider 账号调用；
- LevelSpec、地图或关卡编辑器；
- 专业角色 UI、结构化 Handoff 或真实多 Agent 并行；
- 用 OpenCode Session 契约替换 GameForge 核心契约；
- 为迁移 GUI 引入 PTY、Git/SSH、tunnel 或 Electron 特权边界。

## 重新评估

只有用户明确重新立项，平台与 Provider 状态才能从 `paused` 恢复。下一版本 TODO 的固定顺序为：文档重排、外部 Provider、LevelSpec、专业角色契约、真实多 Agent 委派。
