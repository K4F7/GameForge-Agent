# GameForge 抖音小游戏 MVP 0.1（历史计划）

状态：paused
日期：2026-07-21
首发目标：`douyin-mini-game`

关系说明：本文件保留抖音小游戏端到端闭环的历史范围和恢复入口。当前产品已由 [Web Game MVP](./mvp-web-game.md) 取代；平台、DevTool 和真机流程不进入当前版本。

## 目标

由 CodeArts Agent 在不人工修改生成源码的情况下，根据中文自然语言任务生成一款竖屏单指“订单收集”小游戏，并完成 Web 预览、确定性玩法验证、抖音小游戏构建和开发者工具本地验收。

MVP 只证明以下闭环：

```text
Task -> GameSpec -> 受管项目生成 -> Web 预览与验证
     -> 小游戏逻辑验证 -> LayaAir 构建 -> 静态门禁
     -> 抖音开发者工具本地编译与模拟器验收 -> Run 完成
```

浏览器版本用于快速预览、真实输入和视觉证据；抖音小游戏版本用于最终平台产物。浏览器通过不得替代小游戏通过，headless 逻辑通过也不得替代开发者工具或真机证据。

## 唯一首发玩法

- `genre`：`arcade`
- `mechanicProfile`：`order-collect`
- 默认题材：花园订单冲刺
- 屏幕方向：竖屏
- 输入：单指拖动角色或篮子；桌面预览提供等价指针或键盘输入
- 单局时长：75 秒
- 初始生命：3
- 订单物品：6 个
- 危险物：3 个
- 胜利条件：在时限内收齐全部订单物品
- 失败条件：时间耗尽或生命归零
- 结束流程：明确显示结果并允许立即重开

MVP 可生成花园、餐厅和百货三种主题，但主题只能改变标题、文案、颜色和素材角色，不得改变核心玩法状态机。

## 技术边界

```text
GameSpec + SimulationCore
        |-- Phaser Adapter -> Web 预览、截图和真实输入验证
        `-- Laya Adapter   -> 抖音小游戏构建和模拟器验收
```

玩法规则、实体状态、订单、计时、生命、分数、随机种子和最终结果由纯 TypeScript `SimulationCore` 持有。Phaser Scene 和 Laya Runtime 只负责输入映射、渲染、动画、声音及平台生命周期适配，不得成为玩法状态的唯一来源。

本阶段固定采用：

- Web：Phaser 4、TypeScript、Vite；
- 抖音小游戏：LayaAir 3.4.0 TypeScript 构建后端；
- 资产：统一 Asset Manifest、程序化占位素材和静音回退；
- 状态：GameSpec、Telemetry、RunEvent 和确定性证据；
- GUI：Workbench/TUI 只读投影 Run 与验证状态。

本阶段不使用 Three.js、React Three Fiber 或 Cocos Creator，不维护 Phaser 小游戏 shim。

## 里程碑

### M0：冻结契约与黄金样例

1. 为订单收集玩法定义稳定的 `mechanicProfile`、输入动作和遥测字段。
2. 固定实体、订单、计时、生命、分数、随机种子和终态结构。
3. 建立一个版本化黄金 GameSpec fixture。
4. 保留现有 `target` 安全边界；若增加 renderer/profile 字段，必须保持旧请求兼容并拒绝隐式猜测。

完成条件：同一 GameSpec 和种子生成相同玩法参数、Manifest 与受管源码哈希。

### M1：双运行时可玩切片

1. 提取或建立引擎无关 `SimulationCore`。
2. 生成 Phaser Web 版本并支持真实指针输入。
3. 生成 Laya 抖音版本并消费相同 GameSpec、资产角色和随机种子。
4. 两端实现相同的胜负、订单、计时、生命和分数语义。
5. 在没有外部 Provider、网络或媒体账号时保持可玩。

完成条件：Web 与 Laya 版本均可人工完成一次胜利和一次失败流程，且遥测字段含义一致。

### M2：自动玩法与视觉验收

1. Web Verifier 使用真实输入完成胜利与失败路径。
2. 保存非空白 Canvas 截图、最终状态、控制台错误、页面异常和失败请求摘要。
3. `verify_minigame_gameplay` 使用隔离 VM、可控输入和时钟验证小游戏胜利与超时失败。
4. 增加跨运行时行为比较，至少核对订单进度、分数、生命、剩余时间和最终结果。
5. 保持 `verification.ready`、`gameplay.verified` 与 `build.ready` 三类证据互不冒充。

完成条件：相同 fixture 的 Web 与 Laya 双终态均通过，行为遥测不存在未解释差异。

### M3：抖音本地产物验收

1. 使用固定 LayaAir 3.4.0 CLI 构建 `bytedancegame` 产物。
2. 执行文件结构、包体、Manifest、媒体哈希、远程脚本、域名和 capability 静态门禁。
3. 使用 `minigame:handoff` 生成双快照与聚合 SHA-256 交付摘要。
4. 在抖音开发者工具中完成本地导入、普通编译和模拟器操作。
5. 记录脱敏截图、编译问题数、模拟器结果、人工干预和工具版本。

完成条件：开发者工具本地编译无错误，模拟器中可完成胜利、失败和重开；不执行平台 preview、上传、提审或发布。

### M4：真实 CodeArts 批量闭环

1. 使用真实 CodeArts 创建、认领并完成 10 个独立任务。
2. 任务至少覆盖花园、餐厅和百货三种主题。
3. 全部任务必须由受管工具生成，不允许人工修改生成源码。
4. 每次记录模型、耗时、MCP 工具调用、RunEvent、人工干预和最终结果。
5. 至少一个生成项目取得抖音开发者工具本地模拟器证据。

完成条件：10 个任务全部通过生成、Web 双终态、小游戏双终态、Laya 构建和静态门禁，且不存在随机失败或事件序列缺口。

## GUI 状态

Workbench 和 TUI 必须分别显示以下状态，不得合并为一个“已通过”：

```text
Web Preview             pending | passed | failed
Web Visual Verification pending | passed | failed
Mini-game Logic         pending | passed | failed (no-render)
Douyin Build            pending | passed | failed
Douyin DevTool          disconnected | connected | passed | failed | not-run
```

Relay 连接状态与 DevTool 连接状态必须独立。没有开发者工具证据时必须显示 `not-run` 或 `pending`，不能根据构建成功推断为已验收。

## 完成标准

以下条件全部满足后，MVP 0.1 才能标记完成：

1. CodeArts 能从中文自然语言任务完成端到端生成，无人工源码修改。
2. Web 与抖音版本的订单、分数、生命、倒计时和最终结果语义一致。
3. 10 个独立任务全部通过确定性生成和双终态验证。
4. 所有生成游戏可在离线、无 Provider 账号的环境中启动。
5. 抖音主包不超过 4 MiB，整体目录不超过 20 MiB。
6. 网络、登录、分享、广告和支付 capability 全部为 `false`。
7. 抖音开发者工具本地编译无错误，并取得模拟器胜利、失败和重开证据。
8. Workbench/TUI 能正确区分预览、视觉、逻辑、构建和 DevTool 状态。
9. 实验记录包含输入任务、模型、耗时、工具调用、人工干预和最终结果。

## 验证命令

基础门禁：

```powershell
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run audit
bun run doctor
bun run doctor:browser
bun run doctor:douyin
bun run bundle:check
```

抖音产物静态验证与交付摘要：

```powershell
bun run minigame:validate -- <release/bytedancegame 的绝对路径>
bun run --silent minigame:handoff -- --project-id <project-id> --target douyin-mini-game <release/bytedancegame 的绝对路径>
```

真实 CodeArts、MCP、浏览器和开发者工具执行步骤沿用 `docs/codearts-quickstart.md`、`docs/game-generation-runtime.md` 与 `docs/douyin-cli-pipeline.md` 的安全边界。只有实际运行对应命令并保存证据后，才能记录为通过。

## 非目标

MVP 0.1 不包含：

- 第二种核心玩法或任意自然语言玩法生成；
- 消除、塔防、跑酷、平台跳跃或完整模拟经营；
- 长线养成、关卡地图、经济系统、每日任务或运营后台；
- 登录、排行榜、云存档、服务端、联网对战；
- 广告、支付、分享、录屏传播或用户画像；
- Three.js、React Three Fiber、Cocos Creator 或 Phaser 小游戏 shim；
- 微信开发者工具正式验收；
- 抖音平台 preview、上传、提审或发布。

## MVP 后续顺序

MVP 0.1 完成后，后续工作固定按以下顺序重新立项，不提前并入当前范围：

1. `stack-match`：堆叠、槽位或合并消除模板；
2. `survivor-defense`：固定屏生存、塔防或自动战斗模板；
3. 微信小游戏开发者工具正式验收；
4. 广告、分享、登录等单项 capability 评估；
5. 只有复杂 3D、动画或美术工作流形成明确需求后，才重新评估 Cocos Creator 或 Web 3D 后端。
