# MCP 能力快照结果

## 已实现

- `get_gameforge_capabilities` 始终注册并返回严格 snapshot；
- 国产默认路由固定显示为百炼 Qwen、火山 Seedream、火山豆包语音，音效检索为 Freesound；
- snapshot 只含固定 Provider ID、ready 布尔值和工程能力布尔值；严格对象拒绝额外字段；
- `capabilities.ready` 可保存、回放和持久化恢复；
- Workbench Provider strip 不再静态声称“已支持”，而是等待事件并按实际 ready 显示绿色或 amber；
- CodeArts Skill 要求 snapshot 是 Provider 选择和 UI 状态的权威来源。

完整本地工作流中，Seedream 与 TTS 的完整链路 ready；Qwen 草拟 Provider 未注入，因此 false；Freesound 只注入了 preview/Asset Store 而未注入搜索 Provider，因此完整音效链路为 false。这个结果证明半配置不会误报 ready。

## 浏览器证据

真实 Chrome 初始显示四次“等待 capability 事件”。演示 snapshot 到达后显示：

```text
Qwen 本次 MCP 未配置
Seedream 本次 MCP 未配置
豆包语音 本次 MCP 未配置
Freesound 本次 MCP 未配置
```

DOM 检查为 4 个 pending、0 个 ready、0 个 supported，浏览器 error/warning 为 0。

## 验证结果

- 目标测试：contracts 35、MCP Server 23、Run Relay 26、Workbench 28，全部通过；
- `bun run check`：通过；
- `bun run test`：154 个测试通过，`apps/game` 无测试文件并按既有配置返回 0；
- `bun run build`：通过；Phaser 主 chunk 仍有已知 500 kB 警告，不是构建失败；
- `bun install --frozen-lockfile`：检查 171 个安装、239 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过；
- 端口 4173、5173、8787：无残留监听。

## 边界

- ready 证明适配器及本地依赖已注入，不主动调用云端，因此不证明账号额度、许可或网络可用；
- snapshot 不包含模型 ID、音色或主机白名单，避免把运行配置扩散到浏览器事件流；
- 真实 CodeArts IDE/CLI 尚未执行该发布步骤。
