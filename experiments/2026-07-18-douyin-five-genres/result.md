# 实验结果

状态：官方构建与静态校验通过。

五种 genre 使用同一无额外物理模块的 Laya runtime，并按 GameSpec 分支：

- arcade：连续目标追踪、收集和移动危险物；
- platformer：900px/s² 手写重力、地面/浮台落地、键盘或触摸跳跃；
- puzzle：48px 网格步进和静态危险格；
- shooter：方向记忆、520px/s 子弹、1.4秒寿命、命中移除危险物；
- strategy：谨慎0.72倍/突进1.35倍速度切换，突进碰撞双倍伤害。

官方 `build bytedancegame` 与有界 validator 结果：

| genre | fileCount | totalBytes | assetCount |
|---|---:|---:|---:|
| arcade | 14 | 1,111,856 | 0 |
| platformer | 14 | 1,111,872 | 0 |
| puzzle | 14 | 1,111,856 | 0 |
| shooter | 14 | 1,111,860 | 0 |
| strategy | 14 | 1,111,864 | 0 |

上述最终五项目均已包含 `GameGlobal.__GAMEFORGE_TEST__` 遥测；遥测包含 running/won/lost、genre、score、lives、remainingSeconds，以及玩家、收集物和危险物坐标。

独立审查要求处理非抖音 Laya 预览中可能不存在 `GameGlobal` 的情况；遥测宿主现以 `typeof GameGlobal !== "undefined"` 选择抖音全局，否则回退 `Laya.Browser.window`。修正后用全新 platformer 项目再次执行官方构建，14个文件、1,111,972 bytes、校验通过。

这组证据证明五种源工程可被官方编译器接受、发布结构与离线门禁通过；没有调用 DevTool 或真实抖音客户端，因此不能声称五种玩法已完成模拟器/触摸/真机验收。
