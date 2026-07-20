# 实验环境

- 日期：2026-07-18
- Node：v24.18.0
- Bun：1.3.14
- 浏览器：系统 Google Chrome，Playwright `channel: chrome`
- Playwright：`playwright-core@1.61.1`
- 视口：1440 × 1000，headless
- 模型：无；事件由确定性 fixture 发布
- 云端 Provider：未调用
- 网络：浏览器只允许本轮 Workbench 静态文件、同源 `/relay/tasks` 与指定 Run 的 replay/SSE、preview `/`，以及 `data:`/`blob:`；Node fixture 直连随机 loopback Relay
