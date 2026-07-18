# 实验结果

抖音官方支持原生 JavaScript/Canvas，并明确 Cocos、Laya、Egret 已完成抖音小游戏适配；另有 Unity WebGL/Wasm 与 Godot 适配专题。官方没有指定唯一推荐引擎。

GameForge V1 选择 LayaAir 3.2 `bytedancegame` 为首选抖音后端，原因是 TypeScript、官方适配库、固定产物结构，以及可由 `LayaAirIDE --project --script` 自动执行的构建任务。Cocos Creator 3.8 LTS 是对照/备选；Unity WebGL 面向 C# 工程，不适合当前 TS 生成链。

本轮只是官方资料选择，没有安装 LayaAir IDE、构建项目或取得抖音开发者工具/真机证据。路线选择仍需同一 GameSpec 原型验证。
