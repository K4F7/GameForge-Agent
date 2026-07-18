# 结果

真实链路为 `GameProjectGenerator → WechatMiniGameBuilder → layaair build wxgame → validateWechatMiniGameProject`。CLI 固定输出 `release/wxgame`，根文件包含 `game.js`、`game.json`、`project.config.json`、`weapp-adapter.js`，并保留 GameForge 平台策略与资产 Manifest。

| genre | 文件 | 总字节 | 结果 |
|---|---:|---:|---|
| arcade | 14 | 1,113,145 | 通过 |
| platformer | 14 | 1,113,161 | 通过 |
| puzzle | 14 | 1,113,145 | 通过 |
| shooter | 14 | 1,113,149 | 通过 |
| strategy | 14 | 1,113,153 | 通过 |

- 五 genre 顺序构建耗时：42 秒。
- 工具调用：官方 LayaAir CLI `wxgame` 构建 8 次（一次结构 spike、五次正式 genre 基准、一次真实 Node stdio MCP、一次 0.13.0 最终版本复核）；`build_wechat_mini_game` MCP 1 次；云 Provider 0 次。
- MCP 证据：capability snapshot 的 `engineering.wechatBuild=true`，工具返回 `target=wechat-mini-game` 的无路径 `build.ready`，文件 14、总量 1,113,145 bytes、Manifest revision 0，未截断日志。
- 版本复核：全量构建后重新生成的受管 Manifest 明确记录 `generatorVersion=0.13.0`、`target=wechat-mini-game`；对应真实产物 14 个文件、1,113,138 bytes，validator 通过。
- 人工干预：0；首次基准输入因 `objective` 低于 GameSpec 最小长度而在任何项目写入前失败，修正结构化输入后重新执行。
- 模型：无。
- 证据位置：忽略目录 `.gameforge-validation/wechat-five-genres/`，不提交编译缓存与本机绝对路径。
- 边界：尚未在微信开发者工具导入、编译、预览或扫码真机；`urlCheck=false` 等 CLI 模板默认值不能证明开发者后台合法域名已配置。
- 整仓门禁：349 个测试通过；`bun install --frozen-lockfile`、`bun run check`、`bun run build`、`bun run bundle:check`、`bun run audit` 与 `git diff --check` 通过。配置真实 Laya CLI 与受管输出根的 `bun run doctor` 返回 `ok: true`，同时列出 `douyinBuild=true`、`wechatBuild=true` 及两个 build 工具。
