# 抖音小游戏 CLI 自动化边界

更新日期：2026-07-18

## 结论

中国抖音小游戏当前公开工具链不能完成 100% no-GUI 全流程。GameForge 可以把工程生成、Laya 编译、产物静态检查和本地质量门禁全部 CLI 化；平台 Runtime 预览、扫码真机、版本提审、审核状态处理、灰度/全量发布仍需要抖音开发者工具或开放平台控制台。官方公开的完整上传—提审—发布 OpenAPI 属于抖音小程序第三方代开发，不能外推到小游戏。

## 工具选择

| 工具 | 对象 | 可用于 GameForge | 决策 |
|---|---|---|---|
| `layaair` 3.4.0 | LayaAir 工程 | create、build `bytedancegame`、平台产物 | 已采用并真实构建 |
| `bun run minigame:validate` | 抖音产物 | 根文件、配置、DOM、符号链接、分包、4/20 MiB | 已采用 |
| `tt-ide-cli` / `tma` | 中国抖音小程序 | 小程序预览、上传、提审 | 不适用于小游戏 |
| `tt-minigame-ide-cli` / `tmg` 2.1.1 | 中国抖音小游戏 | login/open/set-config/project-version/build-npm/preview/upload | 仅接入本地 `--version` 参数诊断；preview 会上传，其他命令不暴露 |
| `@ttmg/cli` 0.4.2 | 国际 TikTok Mini Games | init/dev/build/upload、TikTok DevTool | 不用于中国抖音；账号与 Client Key 不兼容 |
| 抖音开发者工具 4.5.3 | 中国抖音小游戏 | 平台编译、模拟器、二维码、上传入口 | 平台验收仍需要 |
| 抖音开放平台控制台 | 中国抖音小游戏 | 测试版本、提审、审核、灰度/全量发布 | 最终流程仍需要 GUI |

## 可自动化流水线

1. CodeArts 生成 GameSpec、资产和玩法代码；
2. 固定版本 LayaAir CLI 创建/更新工程；
3. `layaair build bytedancegame` 生成平台目录；
4. GameForge validator 执行离线确定性门禁；
5. Bun 记录包体、文件哈希、模型、工具调用和人工干预；
6. 可选执行 `bun run doctor:douyin`；显式配置平台 CLI 时只执行 `bin/tmg.js --version`，固定验证 2.1.1；
7. 在抖音开发者工具中手工导入产物，只做本地编译器与模拟器检查；
8. 在当前“禁止 preview、上传、提审和发布”策略下停止，不产生平台远程状态。

第 6 步是纯本地只读版本探针。第 7 步需要 GUI，但不应上传代码。平台 preview 会先上传，真机二维码也依赖该远程流程，因此当前不执行。GameForge 不保存登录 session、token、AppSecret 或二维码。

LayaAir 构建同样不经 shell。配置官方 dispatcher、`layaair.cmd` 或版本目录入口时，Builder 只用它定位并核验 3.4.0 的 `versions.json`、`Resources/package.json` 与 `Resources/cli-main.js`，再以当前 Node 直接执行固定主入口。显式信任的本机安装在核验与启动之间仍存在同用户替换文件的 TOCTOU 边界，因此安装目录必须由当前用户控制，构建期间不得被其他进程改写。

## 已实现的安全探针

`GAMEFORGE_DOUYIN_MINIGAME_CLI` 只接受官方包内绝对、已存在、非符号链接的 `bin/tmg.js`。配置后，MCP 条件注册 `get_douyin_mini_game_cli_status`，核验相邻 package name/version/bin，并以当前 Node、受限环境、10 秒超时和 stdout+stderr 合计 8 KiB 上限执行唯一参数 `--version`，要求输出独立的 `2.1.1` 行。返回值不含路径或日志。

该工具面故意不接受任意参数，也不暴露登录、打开、`set-config`、项目 `version`、`build-npm`、`preview` 或 `upload`。特别地，`tmg version` 查询的是线上项目版本，不能用于本地包版本诊断。`tt-ide-cli`/`tma` 0.1.33 的 package identity 会失败，避免把抖音小程序 CLI 误接为小游戏 CLI。未安装 `tmg` 是允许状态，不影响 LayaAir 本地构建、玩法验证和包体校验。

显式配置 JS 入口仍代表信任该本地 npm 安装；版本探针不是恶意代码沙箱。同一用户若能在校验与启动之间替换包文件，仍可能改变被 Node 执行的内容。因此只应指向从官方 registry 固定安装的 2.1.1 包，并用系统文件权限保护全局包目录；不要指向下载目录、可被其他账号写入的路径或自制 wrapper。GameForge 不使用 `.cmd`/shell，也不把任何 CodeArts、Relay 或 Provider 凭据传给该子进程。

## 为什么不是全 no-GUI

- 中国抖音官方只明确小游戏 CLI 支持指定测试通道上传；没有公开小游戏专用的提审、审核查询、发布 CLI/API 文档。
- `tmg preview` 的语义是先上传再生成二维码，不是离线模拟器。
- Lite 命令 `tmg open <project> --mode=lite` 仍是打开开发者工具，不是无头编译器。
- 版本提审要求选择宿主并提交截图，审核通过后的灰度/全量发布由控制台操作。
- 主体认证、备案、版号、广告与支付资质属于平台工作流，CLI 不能绕过。

## 官方依据

- [抖音小游戏版本提审指引](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/guide/minigame/examineguide)
- [抖音开发者工具 Lite 模式](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/dev-tools/developer-instrument/lite-mode)
- [抖音小游戏开发流程](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/guide/minigame/develop/)
- [抖音小程序命令行工具](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/develop/dev-tools/developer-instrument/development-assistance/ide-cli)（仅用于边界对照）
- [`tt-minigame-ide-cli` 官方 npm 包](https://www.npmjs.com/package/tt-minigame-ide-cli)
- [TikTok Mini Games Development Stage](https://developers.tiktok.com/doc/mini-games-development-stage)（国际平台，不是中国抖音）
- [TikTok Mini Games Debugging](https://developers.tiktok.com/doc/debug-your-mini-game)（国际平台，不是中国抖音）
