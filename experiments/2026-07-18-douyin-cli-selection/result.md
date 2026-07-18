# 实验结果

`tt-ide-cli` 的命令是 `tma`，官方只用于小程序；小游戏必须使用 `tt-minigame-ide-cli` 的 `tmg`，因此用户给出的安装命令不能用于 GameForge 当前抖音小游戏产物。

`tt-minigame-ide-cli` 2.1.1 无 install/postinstall 脚本，npm 包只包含 JavaScript CLI；README 公开 version、set-config、远程 preview、upload 和 build-npm，没有离线小游戏 build/validate。`preview` 会先上传项目，属于外部副作用。2.0.0 起默认收集行为数据，可显式关闭。

新的 `ttmg dev` 流程会编译并预检查 game.json、分包与包体，但官方要求 DevTool、Chrome、Node 20+、有效 AppID、平台登录和网络。结论：

- LayaAir CLI 负责本地 `bytedancegame` 构建；
- GameForge validator 负责离线确定性静态门禁；
- 抖音 DevTool/`ttmg dev` 负责平台 Runtime、模拟器和真机；
- 未经明确授权不安装 `tmg`、不登录、不执行 preview/upload。

本轮仅只读 npm 元数据/包清单与官方文档，没有安装、遥测、登录或网络上传。
