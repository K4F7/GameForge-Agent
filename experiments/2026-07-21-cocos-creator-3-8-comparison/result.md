# Cocos Creator 3.8 LTS 对照研究结果

## 结论

Cocos Creator 3.8 LTS 可以作为 GameForge 的成熟备选后端，但当前不应替换 LayaAir 3.4.0，也不宜直接进入生产 target。

核心原因不是 Cocos 缺少抖音或微信支持，而是其官方命令行构建仍要求 GUI 环境。GameForge 当前 LayaAir 链已经具备固定 CLI、无 GUI 本地构建、受管模板哈希、双终态逻辑验收、静态校验和确定性交付摘要；改用 Cocos 会新增编辑器安装、GUI 会话、平台构建扩展、Cocos 项目元数据和新的验证器边界，CodeArts 的自动修复与复现成本更高。

本机未发现 Cocos Creator 或可用 CLI，因此本轮结论属于官方资料与代码影响面对照，不是实际 Cocos 构建通过证据。

## 官方能力

- Cocos Creator 3.8 是 LTS 文档线，项目核心目录包括 `assets`、`library`、`local`、`settings` 和 `temp`；生成后端需要明确区分应提交的源工程与编辑器派生目录。
- 官方命令行支持 `CocosCreator.exe --project <path> --build <options>`，可以传 `platform`、`buildPath`、`outputName`、场景、调试、MD5 Cache、平台 packages 或 `configPath` JSON。
- 官方定义命令行退出码：参数非法、构建错误和构建成功可机械区分。
- 官方同时明确命令行运行仍需要 GUI 环境；CI 需要可用桌面会话。因此它不是纯 headless 构建器。
- 微信和抖音均有 Creator 构建扩展与专属发布面板。构建产物仍需对应开发者工具导入、预览和调试；审核与发布继续走平台官方流程。
- Cocos 支持 TypeScript、2D、Asset Bundle、分包和平台专属构建配置，复杂内容生产能力强于当前固定 Laya 模板。

## 与当前 LayaAir 后端对照

| 维度 | LayaAir 3.4.0 当前证据 | Cocos Creator 3.8 LTS 结论 |
|---|---|---|
| 本地构建 | 固定 CLI 已真实完成 `bytedancegame`、`wxgame` | 官方有 CLI，但要求 GUI 环境；本机未安装，未实跑 |
| CodeArts 自动化 | 可由 stdio MCP 直接调用固定 Node/CLI 链 | 需要管理 Creator 可执行文件、GUI 会话和构建扩展状态 |
| 源工程生成 | 固定少量 TypeScript、场景和设置文件，模板哈希已锁定 | 需新增 Cocos 项目、场景、资源 UUID/meta 与 settings 契约 |
| 逻辑验收 | 已有受管 `Main.ts` 的隔离 Laya runtime harness | 现有 fake Laya runtime 不可复用，需要独立 Cocos harness 或浏览器遥测 |
| 静态校验 | 已锁定 Laya adapter、入口、包体、平台 API 与交付哈希 | 需重新登记 Cocos adapter、输出布局、引擎文件与平台配置 |
| 平台能力 | 抖音和微信五种 genre 均已真实 CLI 构建 | 官方支持成熟，Asset Bundle 与平台构建选项更丰富 |
| DevTool/真机 | 仍需平台工具；抖音已完成本地模拟器 | 同样仍需平台开发者工具，不能消除最终平台验收 |
| 修复成本 | CodeArts 已有固定 Skill、模板和错误分类 | 初期错误面更宽，涉及编辑器资源数据库、构建扩展和 GUI 环境 |

## 仓库改动面

若后续实现 Cocos spike，不能只替换一个模板。至少需要：

1. 新增独立 engine/backend 契约，避免把 Cocos 伪装成现有 Laya target；
2. 新增 Cocos 源工程生成器、项目设置和资源 metadata；
3. 新增固定版本 Creator 可执行文件解析、GUI 环境诊断和构建器；
4. 新增 Cocos 产物 validator、可信 adapter 哈希与 handoff Schema；
5. 新增逻辑或浏览器遥测验收，不复用 fake Laya runtime；
6. 扩展 Asset Store 路径、RunEvent、benchmark、Workbench 与测试中的 Laya 固定假设。

可继续复用 GameSpec、资产 provenance/哈希、生成事务、Run Relay、MCP 确定性边界、包体快照和浏览器截图框架。

## 建议的下一阶段

暂不新增生产 `cocos` target。若要继续，先做受限 spike：

1. 从官方渠道安装并锁定一个精确的 Creator 3.8.x 版本；
2. 创建最小 2D TypeScript 项目，只生成程序化素材；
3. 用官方 CLI 分别构建抖音和微信目标，记录 GUI 会话前置、退出码、耗时和输出结构；
4. 验证同一源工程连续构建的文件清单与哈希漂移；
5. 让 CodeArts 修复一个确定性编译错误，与 LayaAir 同类错误比较工具调用、耗时和人工干预；
6. 只有在构建、静态校验和至少一种可玩性证据稳定后，才设计正式 backend 契约。

通过条件：两个平台构建均退出成功；输出保持在受管目录；无账号或隐私内容进入证据；重复构建差异可解释；CodeArts 能在不修改编辑器派生目录的情况下修复固定错误。

## 边界

- 本轮没有安装或启动 Cocos Creator；
- 没有生成 Cocos 项目或执行真实构建；
- 没有执行抖音/微信 DevTool、preview、真机、上传、提审或发布；
- Cocos 文档站页脚标注 MIT，但不能据此推断 Creator 安装包、编辑器服务和所有随附组件均采用同一许可；正式引入前仍需核对最终用户许可和随附第三方清单。

## 官方资料

- [Cocos Creator 3.8 命令行发布](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-in-command-line.html)（访问日期：2026-07-21）
- [Cocos Creator 3.8 构建选项](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/build-options.html)（访问日期：2026-07-21）
- [Cocos Creator 3.8 构建流程](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/build-guide.html)（访问日期：2026-07-21）
- [Cocos Creator 3.8 微信小游戏发布](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-wechatgame.html)（访问日期：2026-07-21）
- [Cocos Creator 3.8 抖音小游戏发布](https://docs.cocos.com/creator/3.8/manual/zh/editor/publish/publish-bytedance-mini-game.html)（访问日期：2026-07-21）
- [Cocos Creator 3.8 项目结构](https://docs.cocos.com/creator/3.8/manual/zh/getting-started/project-structure/index.html)（访问日期：2026-07-21）
