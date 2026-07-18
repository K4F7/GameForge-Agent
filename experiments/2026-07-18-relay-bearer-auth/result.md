# Run Relay 可选 Bearer 防护结果

## 实现

- Relay `authToken`/`GAMEFORGE_RUN_RELAY_TOKEN` 可选；服务端校验 32–512 字符且无换行；
- 配置后除 OPTIONS 外，Task 创建/列表/详情/认领、Run 创建/发布/回放/SSE/停止/完成全部统一认证；
- 缺失或错误 token 返回 401 `authentication_required` 与 `WWW-Authenticate: Bearer`；比较使用 SHA-256 定长摘要和 timing-safe equality；
- RunRelayClient、MCP、TUI 普通请求与 SSE、benchmark、OpenCode Plugin 从进程环境传 Authorization，不写 URL；
- OpenCode 示例和动态配置只保存 `{env:GAMEFORGE_RUN_RELAY_TOKEN}` 引用；Workbench 不读取 token。

## 验证

- Run Relay 5 个测试文件、30 个测试通过；
- TUI 6 个测试文件、16 个测试通过；
- 覆盖无认证/错 token/正确 token、OPTIONS、客户端 URL/header、短 token 拒绝和 SSE header。
- 使用只存在于临时进程环境的测试 token 启动 production Relay；无 Authorization 的 `GET /tasks?limit=1` 返回 401；
- 同一环境下 `bun run tui -- list` 成功返回 `No tasks.`；
- 同一环境下 `bun run doctor` 成功完成真实 Node stdio MCP 握手，识别 `runRelay: true`、`taskInbox: true`，并通过一次只读 Task 列表探测；
- 冒烟结束后已停止该 Relay，8787 无残留监听；token 值未写入仓库、URL、日志或实验记录。

整仓门禁结果见本文件末尾，所有命令均在同一工作树实际执行。

## 边界

- 默认 CLI 仍固定 loopback 且 token 可选；
- CORS 不是认证；嵌入式非 loopback 服务必须配置 token 和网络层访问控制；
- 原生 EventSource 无自定义 Authorization，Workbench 的带认证远程部署必须使用同源认证代理，禁止把 token 放入 `VITE_*`。

## 整仓门禁

- `bun install --frozen-lockfile`：通过，198 个安装项、281 个包，无变更；
- `bun run check`：通过；
- `bun run test`：通过，281 项测试；
- `bun run build`：通过；Phaser 异步 chunk 仍有已知的 Vite `>500 kB` 非失败警告；
- `bun run bundle:check`：通过；
- `bun run doctor`、`bun run doctor:browser`、`bun run doctor:desktop`：通过；
- `bun audit --prod`：默认审计连接连续两次以 `ConnectionClosed` 中断；显式使用同一 npm 官方 registry 的 `bun audit --prod --registry https://registry.npmjs.org` 后通过，0 个已知漏洞；
- `git diff --check`：通过。
