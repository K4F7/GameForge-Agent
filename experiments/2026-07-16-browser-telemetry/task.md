# 实验任务

## 目标

对生成器托管的 Phaser 游戏取得真实系统 Chrome 证据，验证：

1. 受控 Vite 页面能启动并出现 Canvas；
2. `window.__GAMEFORGE_TEST__` 能返回结构化 running 状态；
3. CodeArts 可依据只读 telemetry 设计有限动作并达到 won；
4. 控制台、页面异常和失败请求保持为空；
5. 失败尝试必须保留为失败，不得冒充通过。
6. 以有上限的等待动作让倒计时自然归零，取得真实 lost 状态与视觉证据。

## 输入

- GameSpec：60 秒 Arcade，方向键移动，收集 5 个目标，倒计时归零失败。
- 项目：先使用生成器 0.1.0 的 `bun-preview-smoke` 定位问题，再以生成器 0.2.0 创建 `telemetry-smoke` 验证修复。
- 云模型调用：0。
- 人工中途干预：0。
