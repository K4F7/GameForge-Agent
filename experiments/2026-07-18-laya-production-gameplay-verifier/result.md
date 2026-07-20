# 结果

真实 Node stdio MCP 在同一受管输出根中调用 `verify_minigame_gameplay` 10 次，覆盖抖音和微信的 arcade、platformer、puzzle、shooter、strategy。每次都返回 `genre-win=won`、`timeout-loss=lost`，且 `hasVisualEvidence=false`。

| target | genre 数 | 调用数 | 双终态 | 视觉字段 |
|---|---:|---:|---|---|
| douyin-mini-game | 5 | 5 | 全部通过 | 无 |
| wechat-mini-game | 5 | 5 | 全部通过 | 无 |

- 加固后单次耗时：9–98 ms；十次顺序 MCP 验收总命令约 3.1 秒（含构建 MCP 与启动）。超时路径按每秒一帧推进，硬限制 2,500 个 timer step。
- 工具调用：`verify_minigame_gameplay` 10 次；云 Provider 0 次。
- 人工干预：0。
- 失败关闭证据：首次尝试读取旧版抖音实验项目时，因 `Main.ts` 不匹配当前固定模板哈希而在创建 VM 前拒绝；随后使用 0.13.0 当前生成器重新生成等价受管项目，不绕过校验。
- 完整性加固：同时核验 `generatorVersion`、顶层 `specSha256`、重建的 `planSha256`、Manifest 文件条目及实际文件哈希。
- 证据位置：忽略目录 `.gameforge-validation/laya-gameplay-proof-v013/`。
- 边界：无 Laya renderer、Canvas、截图、音频解码、平台 API、DevTool 或真机输入；不得把本结果写成视觉/平台验收通过。
- 整仓门禁：355 个测试通过；`bun install --frozen-lockfile` 无变更，`bun run check`、`bun run build`、`bun run bundle:check`、`bun run audit` 与 `git diff --check` 通过。配置真实受管输出根与 Laya CLI 的 `bun run doctor` 返回 `ok: true`，并确认 `gameplayVerifier=true`、`verify_minigame_gameplay` 已注册。
