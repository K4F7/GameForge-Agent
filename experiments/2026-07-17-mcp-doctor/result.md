# MCP 配置体检结果

## 实现

- 新增 `bun run doctor`：先构建 foundation 和 MCP，再由 Node 运行 doctor；
- preflight 检查 Node >=22.12、Bun >=1.3.14、`bun.lock` 存在、`package-lock.json` 不存在、MCP dist 入口存在；
- 真实 `StdioClientTransport` 启动生产 `dist/index.js`，要求四个基础工具并调用 `get_gameforge_capabilities`；
- ready capability 必须存在对应条件工具；Task Inbox ready 时执行一次 `list_game_tasks({limit: 1})` 只读可达性探测；
- 输出只含结构化状态，失败 stderr 最多 4000 字符、压平换行并按五类凭据环境变量脱敏；
- 任一问题使 `ok: false` 且退出码为 1。

首次运行暴露根脚本只构建 foundation、未构建 MCP 自身，因此找不到 `dist/doctor.js`；修正为 foundation → MCP build → doctor 后通过，未把首次失败写成成功。

## 真实结果

```json
{
  "ok": true,
  "runtime": { "node": "v24.18.0", "bun": "1.3.14" },
  "repository": { "bunLock": true, "npmLockAbsent": true, "mcpBuilt": true },
  "mcp": {
    "tools": [
      "get_gameforge_capabilities",
      "validate_asset_manifest",
      "validate_game_spec",
      "validate_provider_config"
    ]
  },
  "issues": []
}
```

基础 capability snapshot 中四个 Provider 和六个工程能力均为 false，与无运行配置环境一致。没有发起云请求。

另以测试占位值只设置 `VOLCENGINE_ARK_API_KEY`、故意省略 `GAMEFORGE_PROJECT_OUTPUT_ROOT`：doctor 退出码为 1，`ok: false`，问题码为 `mcp_startup`，并准确包含缺失输出根的服务端错误。输出不包含测试凭据值，证明真实 stdio 启动错误也经过脱敏。

真实启动生产 Run Relay，并配置绝对项目输出根后，doctor 返回 assetStore/generator/verifier/preview/runRelay/taskInbox 全 true，17 个工具（含 `get_project_assets`）与 capability 完全一致，Task 列表探测成功。精确停止 Relay 后保留同一 URL 重跑，doctor 退出码为 1，稳定报告 `Configured Run Relay failed the bounded task-list probe.`，证明仅设置 URL 不会误报健康。

## 最终门禁

- `bun run doctor`：真实 stdio 成功，`ok: true`；
- 故意半配置 doctor：退出码 1、`mcp_startup`、凭据不出现在输出；
- `bun run check`：通过；
- `bun run test`：164 个测试通过，`apps/game` 无测试文件并按既有配置返回 0；
- `bun run build`：通过；Phaser 主 chunk 仍有已知 500 kB 警告，不是失败；
- `bun install --frozen-lockfile`：171 个安装、239 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过；
- 端口 4173、5173、8787：无残留监听。
