# 环境

- 日期：2026-07-21
- 主智能体：Codex（GPT-5）
- 子代理：6 个默认配置的只读探索代理，用于官方方案、通用 DevTools 库、第三方接入、测试缺口、扩展打包和工作区复用核验
- 抖音开发者工具：4.5.4，运行中的动态 CDP 端口为 `8465`
- DevTool target：`MiniApp Webview`，类型 `webview`
- Bun：1.3.14
- 新增运行时依赖：`chrome-remote-interface` 0.34.0
- 新增类型依赖：`devtools-protocol` 0.0.1663043、`@types/chrome-remote-interface` 0.34.0
- 构建工具：esbuild 0.25.12
- 总耗时：约 60 分钟
- 外部 Provider：未调用模型、媒体或账号 Provider
- 远程操作：禁止；未执行 preview、上传、真机调试、提审或发布
