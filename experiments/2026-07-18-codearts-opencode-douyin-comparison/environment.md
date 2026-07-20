# 环境

- 日期：2026-07-18
- 系统：Windows，PowerShell
- Bun：1.3.14
- OpenCode：1.18.3，非交互 `run --format json --pure`
- 宿主 Provider/model：`opencode` / `opencode/hy3-free`
- 模型厂商路由：`tencent`，source `explicit-user-override`
- OpenCode data：仓库忽略目录中的独立 XDG data，不与 CodeArts 数据库共用
- MCP：本地 stdio，Node 启动已构建入口
- Relay：loopback HTTP，使用全新隔离持久化状态
- LayaAir CLI：3.4.0
- 媒体 Provider：0 次调用，五类 Provider 均未就绪

非交互实验只在被忽略配置中精确放行创建、认领、审计绑定、项目生成、玩法验收、抖音构建、事件发布和 Run 完成八个 GameForge 工具，并拒绝内置 bash/edit/write/patch。提交的生产模板仍维持修改类工具 `ask`。

官方依据（访问日期 2026-07-18）：

- [OpenCode CLI](https://opencode.ai/docs/cli/)
- [腾讯混元 Hy3 发布说明](https://www.tencent.com/zh-cn/tencent-hunyuan-officially-releases-hy3-advancing-agent-capabilities-and-deeper-product-integration/)
