# Run Relay 可选 Bearer 防护

为包含 Prompt、RunEvent 和控制操作的 Relay 增加可选统一认证，同时保持默认 loopback、无 token 的本地开发兼容。

验收条件：配置 token 后除 OPTIONS 外所有路由均需 Bearer；客户端不把 token 放进 URL；MCP/TUI/SSE/benchmark/Plugin 贯通；Workbench 不读取秘密；真实生产 Relay 与 doctor 探测通过；整仓门禁通过。
