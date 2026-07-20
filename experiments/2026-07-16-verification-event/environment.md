# 环境

- 日期：2026-07-16
- 时区：Asia/Shanghai
- Bun：1.3.14
- Vitest：4.1.10
- Playwright Core：1.61.1
- UI 验收浏览器：系统 Chrome，通过应用内浏览器控制
- 模型/云 Provider 调用：0
- 密钥使用：0
- 人工干预：0

完整工作流中的 verifier 使用确定性测试替身以验证事件转换；verifier 本身的动作、截图路径和诊断边界由 `@gameforge/game-verifier` 独立测试及既有真实 Chrome 游戏实验覆盖。
