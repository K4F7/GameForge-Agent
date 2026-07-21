# 实验结果

## 结论

Cocos Creator 3.8.8 到抖音开发者工具 4.5.4 的本地回环已经实际跑通。官方 Empty2D 项目能够承载固定场景、TypeScript 游戏脚本、程序化 2D 画面和本地音频；Creator CLI 完成 `bytedance-mini-game` 构建后，DevTool 使用测试 AppID 成功导入并加载 `db://assets/scene.scene`。

模拟器显示竖屏“星际采集：霓虹航线”。点击开始后，倒计时从 45 秒推进，收集物与危险物生成，能量从 0 增至 20；护盾耗尽后进入“任务中止/点击重新挑战”。这证明场景加载、脚本生命周期、渲染、输入、计时、碰撞、计分和失败终态在抖音模拟器中真实执行。

该结果证明固定官方 Cocos 模板路线可行，但不代表 GameForge 仓库已经具备 Cocos 生产 target。当前确定性 MCP、生成器、validator、builder、handoff 和 RunEvent 仍以 LayaAir 为主，需要独立的 Cocos backend vertical slice。

## 构建证据

- Creator 日志记录 `打包脚本 success`、`Build Assets success` 和 `build Task (bytedance-mini-game) Finished in (1 min 22 s)`；
- 输出共 35 个文件、11,082,428 字节，聚合 SHA-256 为 `8aea3b092a8c22e4d327523e0ac46932cdca3cb446c1b0e5a94a3a883398a6d9`；
- 输出包含 `game.js`、`game.json`、`project.config.json`、`application.js`、`engine-adapter.js`、`web-adapter.js`、`assets/`、`cocos-js/` 和 `src/`；
- `game.json` 声明 `deviceOrientation: portrait`；
- `src/settings.json` 声明 Cocos 3.8.8、平台 `bytedance-mini-game` 和启动场景 `db://assets/scene.scene`；
- 构建脚本包包含 `GameBootstrap` 与 `__GAMEFORGE_TEST__`，资源索引包含 `audio/bgm` 和 `audio/eat`；
- BGM 为 4,485,656 字节，音效为 21,062 字节。

## DevTool 证据

- 工程窗口标题为 `bytedance-mini-game - 抖音开发者工具`；
- 资源管理器列出完整 Cocos 平台输出；
- 编辑器问题计数为错误 0、警告 0；
- 控制台显示 `Cocos Creator v3.8.8`、`Success to load scene: db://assets/scene.scene`；
- 模拟器成功显示竖屏 HUD、飞船、收集物、危险物和帧率统计；
- 点击开始后观察到 45.0 秒倒计时推进、能量 20、护盾耗尽和失败终态；
- DevTool 控制台没有游戏脚本错误。

出于隐私与安全考虑，本轮不提交含账号头像、测试 AppID 或本机路径的原始截图。证据来自实时窗口可访问性树、模拟器画面和本地构建产物核验。

## 暴露的问题

1. Creator AssetDB 对外部新建目录和文件的热刷新不可靠；本轮需要关闭并重新打开项目，冷启动扫描后才生成 `.meta` 并完成导入。固定模板流程需要显式的资源刷新或重启门禁。
2. 直接把 CLI 参数写进 `--build` 字符串时，`buildPath` 和 `debug` 被按字符串解析并触发类型校验回退。后续应使用受管 `configPath` JSON，并捕获官方成功退出码 36。
3. 首次从短生命周期终端启动 Creator CLI 时，Creator 继续向已关闭 stdout 写入并产生 `EPIPE`。构建器必须保持父进程、重定向日志并等待退出。
4. 平台方向是竖屏，但构建设置仍保留 1280×720，运行脚本又在启动时改为 720×1280。当前模拟器可显示，但固定模板必须统一源设置、运行时设计分辨率和平台方向。
5. 产物约 10.57 MiB，低于当前整体 20 MiB 门禁，但显著超过现有 4 MiB 主包目标。4.49 MB 的 BGM 与未裁剪引擎模块是主要优化对象，需要音频压缩、引擎模块裁剪或分包设计。
6. BGM 与音效已进入产物且运行时未报加载错误，但自动化没有音频采集能力；实际可听性仍需一次人工听感确认。
7. 场景中自定义组件的压缩 class id 本轮由固定模板一次性固化。后续 Agent 不应每次重写 `.scene` 的内部序列化结构，而应优先只生成 TypeScript、受管 JSON 和资产。
8. DevTool 当前使用测试 AppID，只能证明本地编译与模拟器运行；不构成真机、审核或发布证据。

## 建议的固定流程

1. 从版本锁定的官方 Cocos 模板复制受管源项目；
2. Agent 只修改允许清单内的 TypeScript、业务 JSON 和资产；
3. 通过 Creator 资源刷新门禁确认 `.meta` 与 UUID 完整；
4. 使用受管 `configPath` 调用 Creator CLI，并重定向 stdout/stderr、等待退出码；
5. 对输出执行 Cocos 专属静态校验、包体快照和遥测检查；
6. 导入抖音 DevTool，完成本地编译、模拟器画面与基本交互验收；
7. 平台预览、真机、上传、提审和发布继续保持显式禁用。

## 边界

- 未调用百炼、Seedream、豆包、Freesound、MiniMax 或其他外部 Provider；
- 未点击 DevTool 的“预览”“真机调试”“性能测试”“上传”或“分享工程”；
- 未执行平台远程操作；
- 未把外部 Cocos 项目、生成产物、原始日志、账号状态或本机绝对路径提交到仓库。
