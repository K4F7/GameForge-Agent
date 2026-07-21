# 任务

## 输入

验证官方 OpenChamber 能否在尽可能保持原版的前提下直接连接当前 CodeArts Agent，并为第一版提供可重复的固定版本、启动和兼容性检查。后续 GameForge 功能应优先通过 OpenChamber 已有接口、MCP 或插件扩展，不重新实现 GUI、会话或 Agent 循环。

## 验收条件

- 使用官方 `openchamber/openchamber` 仓库并固定可复现提交；
- OpenChamber 上游 checkout 与运行数据不进入仓库，也不与 CodeArts/OpenCode 私有状态混用；
- 原版 OpenChamber Web 能连接真实 CodeArts 26.6.2 server；
- 项目、Provider、Model、Agent、MCP 和 Session 接口可经 OpenChamber 正常访问；
- 提供只读兼容性探针和可执行启动命令；
- 不复制 OpenChamber UI，不修改上游 checkout，不调用外部 Provider。
