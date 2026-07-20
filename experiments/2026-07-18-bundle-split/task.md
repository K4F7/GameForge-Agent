# 生成游戏首屏拆分与包体预算

将示例游戏和生成模板从顶层 Phaser 导入改为轻量 loader + 异步游戏模块。通过 Vite manifest 区分初始、异步和总体积，预算超出时使 CI 失败。生成一个全新独立游戏，验证 TypeScript、生产构建、Canvas 首屏和浏览器日志。

禁止仅提高 Vite chunk warning 阈值，也不得把异步拆分描述成 Phaser 总下载量减少。
