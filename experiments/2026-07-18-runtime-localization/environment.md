# 环境

- 日期：2026-07-18
- 时区：Asia/Shanghai
- Bun：1.3.14 或当前锁定兼容版本，负责生成、依赖、检查、测试和构建
- 浏览器验收 runtime：Node 24 + Playwright Core 1.61.1 + 系统 Chrome
- 游戏模板：Phaser 4.2.1 + Vite 8.1.4 + TypeScript 严格模式
- 模型调用：0（使用固定 GameSpec，隔离运行时语言行为）
- 云 Provider 调用：0
- 人工干预：截图视觉检查 1 次
- CodeArts Agent 调用：0；本机已安装客户端，但本实验未通过真实 CodeArts 会话执行，不能声称 CodeArts 集成验收

最终生成目录位于已忽略的 `.gameforge-validation/runtime-localization-20260718-v2/`。首次样例暴露缺少 favicon 的 404 后被保留为失败证据；生成器修复后使用 v2 新目录重跑，没有覆盖旧项目。
