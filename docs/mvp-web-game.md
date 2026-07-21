# GameForge Web Game MVP

状态：in-progress
日期：2026-07-21
当前版本：`0.1.0-alpha.1`
需求基线：[Web Game PRD](./prd-web-game.md)

## 目标

让一个真实用户从原版 OpenChamber 提交普通自然语言需求，由真实 CodeArts 调用 GameForge MCP 创建或修改 Phaser Web 2D 项目，并在 Chrome 中取得可回放的玩法与视觉证据，最后由 OpenChamber 展示预览、日志和验证结果。

只完成 OpenChamber 与 CodeArts 的只读兼容探针不算 MVP 通过。

## MVP 闭环

```text
OpenChamber prompt
  -> CodeArts session
  -> GameForge Task / Run
  -> GameSpec validation
  -> Phaser Web project create or update
  -> build
  -> controlled preview
  -> Chrome gameplay and visual verification
  -> Relay terminal events
  -> OpenChamber evidence projection
```

## 实现范围

1. 固定并启动一个可追踪的 OpenChamber 上游版本；
2. 使用隔离数据目录连接 CodeArts headless server；
3. 保留 OpenChamber 原生 Session 交互；
4. 通过 adapter 展示 GameForge Project、Task、Run、预览、日志和证据；
5. 创建新的 Phaser Web 2D Project；
6. 通过显式 `projectId` 修改既有 Project；
7. 使用真实 Chrome 完成输入、目标行为、截图和诊断检查；
8. 以 `arcade` 黄金任务完成第一条真实闭环；
9. 保留其他四种模板并在 RC 前完成回归。

## GameSpec 边界

GameSpec 是创建基线和验收输入所使用的引擎无关语义契约。它不序列化 Phaser 对象，也不成为创建后所有代码修改的唯一来源。项目创建后，真实代码、测试、Manifest 和验证证据共同构成项目事实。

当前只规范 `GameSpec / LevelSpec / AssetManifest / Telemetry / RuntimeAdapter` 的分层；LevelSpec 实现进入下一版本 TODO。

## 完成标准

以下条件全部满足后，版本才可以从 `alpha` 进入 `beta`：

1. 原版 OpenChamber 可以提交真实需求，而非只读取健康状态；
2. CodeArts 真实调用 GameForge MCP，并保存 Task、Run 和工具审计；
3. `arcade` Project 完成创建、构建、预览和 Chrome 验证；
4. OpenChamber 可以访问对应预览、日志和验证证据；
5. 同一 Project 完成一次显式 `projectId` 修改并复验；
6. 全程不依赖外部 Provider、DevTool 或平台账号；
7. 实验记录包含输入、模型、耗时、工具调用、人工干预和最终结果；
8. 以下门禁全部实际运行并通过：

```powershell
bun run check
bun run test
bun run build
bun run workbench:smoke
```

`workbench:smoke` 在 MVP 完成时必须覆盖真实 Relay、OpenChamber/GUI 入口和 Chrome 验证链路；仅验证旧 Workbench fixture 不满足最终门槛。

## 明确不包含

- 平台 target、LayaAir、抖音、微信或 DevTool；
- 外部 Provider 和账号级调用；
- LevelSpec、地图编辑和关卡编辑；
- 专业角色交互、Handoff 或真实多 Agent；
- 资产候选审批系统；
- PTY、Git/SSH、tunnel、Electron 特权或远程部署；
- “生产级”或“可发布”声明。

## RC 与正式版

- `beta -> rc`：五种 Web 模板回归、新建与修改流程、四项门禁全部通过且无阻塞缺陷；
- `rc -> stable`：功能冻结，发布说明、升级/回滚说明和最终复验完成；
- 正式版之后只通过 PATCH 版本发布 Hotfix。
