# CodeArts + MiniMax Music 3.0 Free 闭环实验结果

## 结论

首次实验因 MiniMax 账户额度不足未通过；额度恢复后，第二次真实 CodeArts 实验已完成闭环。Run `run-minimax-music-20260721-03` 的 Task 状态为 `completed`，并产生了真实 BGM、验证、预览、构建和完成事件。

此前的 `1008` 已通过账户额度恢复解决；GameForge 不自动购买或修改账务。

## 成功闭环 Run（2026-07-21）

- Run：`run-minimax-music-20260721-03`
- Task：`task-a8469cc8-81c5-48fb-8f38-23b901cf4372`
- projectId：`minimax-music-web-20260721-03`
- Task 状态：`completed`，`claimedBy: codearts`
- 连续事件：`run.started` → `capabilities.ready` → `spec.ready` → `asset.ready` → `verification.ready` → `preview.ready` → build phase completed → `run.completed`
- BGM：MiniMax `music-3.0-free`，3,239,486 bytes，许可证 `non-commercial`
- `asset.ready` SHA-256：`40c78d3b306e5e9bba49fb953b77ed67d6caa09cdc625f674bebeca73c94b180`
- 验证：`passed=true`、`outcome=won`、`score=5`、`lives=3`、Canvas `960x540`、控制台/页面错误均为 0
- 预览：`http://127.0.0.1:5173/`
- 构建：`tsc --noEmit + vite build` 成功，`dist/` 已生成
- MCP 审计：真实调用 `generate_music_asset`、`verify_game_project`、`start_game_preview`、`complete_game_run` 均成功

## CodeArts Run

- Run ID：`run-minimax-music-20260721-02`
- projectId：`minimax-music-web-20260721-02`
- Task：由真实 CodeArts 创建并以 `claimedBy: codearts` 认领
- 最终 Task 状态：`stopped`
- 连续事件：`1 run.started`、`2 run.stopped`

CodeArts 会话没有按提示调用 GameForge MCP，而是直接通过 Relay HTTP 创建/认领 Task，并尝试调用 `provider:smoke`。检测到其偏离“单次 MCP 媒体调用”验收条件后，主代理停止会话；不得把该 CodeArts 进程退出码 0 解释为闭环成功。

## 调试与真实请求

1. 首次 CodeArts 会话继承了不完整的其他 Provider 环境并反复运行 `doctor`，未创建 Task；终止后清空无关 Provider 配置。
2. 动态 CodeArts 启动器原先没有把 MiniMax 变量写成安全 `{env:...}` 引用；已补齐并增加集成测试。
3. `provider:smoke --providers=music` 原先强制依赖 Qwen；已改为使用严格校验的确定性本地 GameSpec，避免为了音乐 smoke 调用无关模型。
4. Provider 失败响应可能返回 `data: null`、`extra_info: null`；适配器现可解析并脱敏报告官方状态码。
5. 调试期间共发起四次单次 MiniMax music generation 请求；每次 Provider 调用内部均为 `maxAttempts: 1`，没有自动重试：
   - 使用 `sk-cp` Key 时返回空失败数据，修复诊断后确认状态 `2061`；
   - 控制台确认普通 API Key 使用 `sk-api` 前缀并替换本机用户环境；
   - 使用 `sk-api` Key 后鉴权通过，但返回状态 `1008`。

没有任何请求返回音频数据，未产生可验收音乐文件。

## 已通过部分

- `music-3.0`、`music-3.0-free` 已进入 Provider 与 MCP 模型 allowlist；
- `get_gameforge_capabilities` 返回 `providers.music.ready: true`；
- MCP 工具列表包含 `generate_music_asset`；
- 确定性 Web GameSpec 与受管项目生成成功；
- 普通 `sk-api` Key 已保存为 Windows 用户级环境变量且未泄露完整值；
- Relay 状态持久化并将未完成 Run 正确停止。

## 未通过部分

- MiniMax 音乐生成成功响应；
- MP3 魔数、大小和 SHA-256 校验；
- Asset Store `bgm` 入库和 Manifest revision；
- `asset.ready`；
- 含真实 BGM 的生产构建、浏览器音频解锁和 Chrome 玩法验收；
- `preview.ready`、`verification.ready` 与 `run.completed`。

## 恢复步骤

1. 用户在 MiniMax 控制台为按量账户取得可用额度，并确认普通 API Key 可用于 `music-3.0-free`；
2. 只运行一次：`bun run provider:smoke -- --execute --providers=music`；
3. 只有 smoke 返回 MP3 并成功入库后，创建新的 Run ID 重新执行真实 CodeArts 媒体闭环；
4. 机械核验连续事件中存在真实 `asset.ready`，其 `role=bgm`、`kind=music`、`provider=minimax`、`model=music-3.0-free`、`license=non-commercial`；
5. 再继续构建、Chrome 验收、预览和终态。

## 验证结果

- `bun run --filter @gameforge/integrations test`：11 项通过；
- `bun run --filter @gameforge/providers test`：53 项通过；
- `bun run --filter @gameforge/providers check`：通过；
- `bun run --filter @gameforge/mcp-server check`：通过；
- 真实 Provider smoke：失败，MiniMax status `1008`；
- Relay：Task `stopped`，事件 sequence 1–2 连续。

## 官方依据

- [MiniMax 音乐生成 API](https://platform.minimaxi.com/docs/api-reference/music-generation)（访问日期：2026-07-21）
- [MiniMax 按量计费](https://platform.minimaxi.com/docs/guides/pricing-paygo)（访问日期：2026-07-21）
- [MiniMax 错误码](https://platform.minimaxi.com/docs/api-reference/errorcode)（访问日期：2026-07-21）
