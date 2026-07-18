# 任务

把测试专用的 Laya headless 宿主提升为 CodeArts 可调用的生产 MCP 逻辑验收，同时保持它与浏览器截图、小游戏 DevTool 和真机证据严格分离。

验收条件：

- 只执行生成器当前固定模板，拒绝修改过的 `Main.ts`、GameSpec 或伪造 target；
- 抖音与微信的五种 genre 各证明一个 `won` 和一个 `lost` 终态；
- MCP 返回无绝对路径、Canvas、截图或视觉证据的 `gameplay.verified`；
- Workbench/TUI 明确显示 no-render 边界；
- 整仓门禁通过。
