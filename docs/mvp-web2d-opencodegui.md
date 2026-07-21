# GameForge Web 2D 专业 Agent GUI MVP

状态：实施中
日期：2026-07-21
需求基线：[Web 2D 与专业 Agent GUI PRD](./prd-web2d-opencodegui.md)

## 目标

在不改变现有 Workbench 三栏布局、不新增第二套 Agent 循环的前提下，让用户通过 `@策划`、`@程序员`、`@美术` 和 `@测试` 表达专业分工，并让这一意图成为可校验、可持久化、可回放和可审计的 Task 数据。

本 MVP 是当前抖音小游戏闭环完成后的 Web 2D + GUI 产品切片。它不替代 [抖音小游戏 MVP 0.1](./mvp-plan.md) 的历史范围和证据。

## MVP 用户流程

```text
打开现有 Workbench
  -> 在游戏需求中点击或输入 @专业角色
  -> GUI 显示已点名角色
  -> 提交给 CodeArts
  -> Relay 持久化 Prompt + requestedSpecialists
  -> Task 历史显示角色
  -> CodeArts 完成 Web 2D 工作
  -> GUI 展示预览、Diff、日志和验证证据
```

## 本轮实现范围

### 1. 角色交互

- 在现有“游戏需求”输入框下增加四个角色按钮；
- 点击后向 Prompt 添加合法 `@角色`；
- 已存在的角色不得重复；
- GUI 根据 Prompt 实时显示点名数量和激活状态；
- 角色按钮与连接中的 Task 输入一起锁定。

### 2. 结构化 Task 元数据

- 新增 `planner | programmer | artist | tester` 专业角色 Schema；
- Task 请求与持久化对象新增规范化 `requestedSpecialists`；
- 缺少字段的旧 Task 按空集合读取；
- 未知角色拒绝；
- 同一 Run ID 改变角色集合时返回幂等冲突。

### 3. 历史投影

- Task/Run 导航显示 `@角色`；
- 载入历史 Task 后从原始 Prompt 恢复按钮状态；
- “已请求角色”不能被描述成“角色执行完成”。

### 4. 真实角色任务

MVP 完成前必须保存两个真实 CodeArts 实验：

1. `@程序员`：修复一个可复现的 Web 2D Bug，提交代码并通过相关单测、浏览器验证和截图证据；
2. `@美术`：针对一张现有或程序化角色图提出并产出候选修改，不覆盖原资产，记录输入、候选、许可说明和人工选择。

若外部生图账号未配置，`@美术` 使用程序化候选或明确的修改规格，不得为了通过 MVP 擅自调用外部账号。

## 明确不包含

- 专业 Agent 并行执行；
- 自动创建子 Run 或自动合并多个 Agent 的文件修改；
- 新增独立程序、美术、测试页面；
- Cocos Creator、LayaAir IDE 或平台开发工具集成；
- Three.js、React Three Fiber 或 3D 模板；
- 登录、广告、支付、分享、上传、提审和发布；
- PTY、任意命令执行、Git/SSH 或远程 Tunnel。

## 完成标准

1. 四个角色按钮可访问、可键盘聚焦，并正确更新 Prompt。
2. `@程序员助手` 等相似文本不会被误识别。
3. Task Schema 对角色集合执行上限、去重和稳定排序。
4. Relay 创建、幂等重试、冲突判断、列表和持久化恢复均保留角色集合。
5. Task 历史显示角色，旧 Task 兼容为空集合。
6. Workbench 现有预览、Task 历史、CSP、断线恢复和 smoke selector 不退化。
7. `@程序员` 与 `@美术` 两个真实 CodeArts 实验均有可复现记录。
8. 没有证据时不宣称多 Agent 并行或专业任务已经完成。

## 验证命令

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

真实 CodeArts 实验额外记录：Task ID、Run ID、Prompt、`requestedSpecialists`、模型、耗时、MCP 调用、人工干预、最终证据和失败边界。

## 后续迭代

MVP 通过后再评估：

1. 结构化 Specialist Request 与 Finding/Handoff 契约；
2. CodeArts 对专业子任务的显式委派和状态事件；
3. 程序员与测试之间的修复—复验闭环；
4. 美术候选对比、审批和 Asset Manifest 提交；
5. 音频、剧情、合规等新增角色；
6. 只有冲突、权限和合并规则通过验证后才开放并行专业 Agent。
