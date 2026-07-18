# 实验结果

状态：不兼容，触发 ADR-0002 退出条件。

Node CommonJS `require("phaser")` 与 ESM 动态 `import("phaser")` 均在模块初始化阶段失败，首批访问包括 `navigator.userAgent`、`navigator.standalone` 与 `window.cordova/ejecta`。Bun 动态 import/require 同样失败；Bun 静态 import 曾输出成功，但没有可靠证明模块初始化，故不能作为兼容证据。

继续检查 Phaser 4.2.1 发布包还发现：

- 音频/视频探测依赖 `window.Audio`、`AudioContext`、`document.createElement("audio"/"video")`；
- Canvas 与 DOM GameObject 路径依赖 `document.createElement`；
- 主循环依赖 `window.requestAnimationFrame`；
- 图片加载依赖全局 `Image`；
- 可见性与容器逻辑依赖 window/document 事件和 DOM 元素。

结论：这不是只映射 `tt.createCanvas`、触摸和生命周期的薄适配层。继续需要维护大范围浏览器模拟层或 Phaser fork，风险超过 V1 边界。因此 Web target 保留 Phaser，抖音 target 转入 LayaAir/Cocos 官方构建后端对照。本实验没有抖音 IDE/真机运行，不能评价两个候选后端。
