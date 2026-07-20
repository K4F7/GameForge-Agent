# 本地启动与 stdio MCP 结果

## 本地开发栈

执行：

```text
bun run dev:local
```

真实结果：

```json
{"game":200,"workbench":200,"relay":200}
```

两个 Vite 服务在本机监听 IPv6 loopback，因此 HTTP 检查使用 `localhost`；Relay 固定监听 `127.0.0.1`。测试结束后三个监听进程均已清理。

第一次烟测错误使用 `127.0.0.1` 请求 Vite，并采用过度复杂的递归进程清理，导致诊断超时；当时三个端口实际已监听。终止诊断、精确清理监听 PID 后，第二次用正确主机名得到三个 HTTP 200。未把第一次超时写成通过。

## 生产 stdio MCP

先执行仓库构建，然后以官方配置等价参数启动：

```text
command: node
args: [绝对路径/packages/mcp-server/dist/index.js]
env.GAMEFORGE_PROJECT_OUTPUT_ROOT: 绝对输出目录
```

真实 MCP Client 握手成功，列出以下无密钥基础工具：

```json
[
  "generate_game_project",
  "start_game_preview",
  "stop_game_preview",
  "validate_asset_manifest",
  "validate_game_spec",
  "validate_provider_config",
  "verify_game_project"
]
```

第一次临时客户端从仓库根目录运行时无法解析只在 MCP workspace 声明的 SDK，因此服务没有启动；从 `packages/mcp-server` 工作目录重跑后通过。该问题只影响临时测试客户端的模块解析，不影响 CodeArts 使用绝对 `dist/index.js` 启动服务。

## 结论与边界

- Bun 可以用一个命令启动三个本地 HTTP 开发服务；
- CodeArts 可按官方 stdio 结构启动生产 MCP；
- Node 负责正式 MCP/Playwright runtime，Bun 负责依赖、构建和 workspace 命令；
- 未配置 Relay 时不会出现任务工具；未配置云密钥时不会出现 Qwen、Seedream、Freesound 或 TTS 工具；
- 本实验没有证明真实 CodeArts IDE 已保存配置，也没有调用云账号。

## 最终门禁

- `bun run check`：通过
- `bun run test`：130 个测试通过
- `bun run build`：通过
- `bun install --frozen-lockfile`：无变更
- `bun run audit`：0 个生产依赖漏洞
- `git diff --check`：通过
- 生产 Workbench bundle 搜索 `127.0.0.1:8787`：无匹配，开发默认值未固化进生产产物
- 5173/4173/8787 残留监听：无
