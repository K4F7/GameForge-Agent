# MCP 能力快照任务

消除 Workbench 对国产 Provider 的静态“已支持”展示，让界面只根据本次 MCP 进程的实际完整配置显示 ready。

验收条件：

1. 工具无参数且不返回密钥或敏感配置值；
2. 零配置 MCP 准确返回所有可选能力 false；
3. Provider 只有完整依赖链存在时才为 ready；
4. capability snapshot 可通过严格 RunEvent 发布并由 Relay 恢复；
5. Workbench 未收到事件时显示等待，收到后显示已配置或未配置；
6. 完整本地工作流调用工具并发布事件；
7. 真实 Chrome 和 Bun 整仓门禁通过。
