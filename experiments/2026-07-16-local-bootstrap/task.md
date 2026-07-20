# 本地启动与 CodeArts stdio 装配实验

## 目标

验证新用户只使用仓库 Bun 脚本和华为云码道官方 stdio MCP 配置即可启动本地开发栈，并让构建后的 GameForge MCP 被真实客户端发现。

## 验收条件

1. `bun run dev:local` 同时启动游戏、Workbench 和 Run Relay；
2. 5173、4173、8787 三个端口分别返回 HTTP 200；
3. Workbench 开发模式默认连接 loopback Relay，生产模式不隐式连接；
4. Node 按官方 `command`、`args`、`env` 字段启动构建后的 stdio MCP；
5. MCP Client 能完成握手并列出基础工具；
6. Provider 前端标签不把“代码已支持”冒充为“云账号已就绪”。
