# 实验任务

在不安装平台包、不登录、不上传代码的前提下，为 CodeArts 提供一个确定性的抖音小游戏 CLI 前置诊断：只接受 `tt-minigame-ide-cli` 2.1.1 的 `bin/tmg.js` 入口，只执行 `bin/tmg.js --version`，并拒绝将小程序 `tt-ide-cli`/`tma` 当作小游戏工具。

用户约束：平台 preview、上传、提审和发布全部禁止；当前 Agent 模型只考虑 CodeArts 内置模型。
