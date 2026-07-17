# 媒体角色前置契约结果

## 实现与证据

- 共享契约新增 `imageRuntimeAssetRoleSchema`，只包含 `player`、`collectible`、`hazard`、`background`；
- `request_image_asset` 的 MCP 输入和 TypeScript handler 类型都改用该子集；
- Freesound 导入继续只接受 `collect-sound`、`hit-sound`、`bgm`；
- TTS 素材化继续由工具固定写入 `voice`，调用方不能改写角色；
- Asset Store 仍保留最终角色—kind 校验，形成 MCP 前置拒绝与落盘终检两层边界。

真实 MCP SDK InMemoryTransport 测试先执行一次合法 `player` 请求，Provider 与 Store 各调用一次；随后提交 `role: "voice"` 的图片请求，MCP 返回 `isError: true`，两个调用计数均未增加。证明无效请求不会消耗 Seedream 调用，也不会写盘。

## 调用记录

- 模型调用：0；
- 云 Provider 调用：0；
- 确定性合法 Provider 替身：1 次；
- 确定性 Store 替身：1 次；
- 被 Schema 阻止的无效请求：1 次；
- 人工干预：0。

## 验证

- `bun run check`：通过；
- `bun run test`：169 个测试通过，`apps/game` 无测试文件并按既有配置返回 0；
- `bun run build`：通过；
- `bun install --frozen-lockfile`：无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `bun run doctor`：真实 Node stdio MCP 握手通过；
- `git diff --check`：通过。

## 边界

- 该实验验证协议和调用边界，没有调用真实 Seedream、Freesound 或火山 TTS；
- 不带 `role` 的图片仍允许入库，用于 CodeArts 尚未决定运行时绑定的审计素材；只有明确绑定角色时才应用角色子集。
