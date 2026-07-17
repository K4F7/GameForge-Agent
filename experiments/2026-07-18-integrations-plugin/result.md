# Integration 与薄 Plugin 结果

## 配置与权限

- 根 `opencode.json.example` 使用相对 `node packages/mcp-server/dist/index.js`；
- 输出目录与 Relay URL 通过环境占位符注入；
- `gameforge_*` 默认 ask，validate/get/list/replay/query 覆盖为 allow；
- `/gameforge-status` 由 OpenCode command 配置提示模型调用插件工具，不依赖未公开的动态命令注册 Hook。

## 动态启动器

`integrations/shared/runtime.ts` 从嵌套目录向上查找仓库根，生成 `.gameforge-validation/integrations/<client>/opencode.json`。CodeArts 与 OpenCode dry-run 均成功，输出根和配置路径随当前仓库动态计算；生成配置仅包含绝对运行路径和非敏感 Relay URL，不包含 Provider 密钥。

启动器默认：

- CodeArts：Windows 用户目录下的官方安装位置，或 `CODEARTS_BIN`；
- OpenCode：PATH 中的 `opencode`，或 `OPENCODE_BIN`；
- MCP runtime：Node；启动器与工程命令：Bun。

SIGINT/SIGTERM 会转发给子客户端；Windows 使用 `taskkill /T` 只清理由启动器创建的进程树，修复 Scoop shim 外层退出后 OpenCode 子进程残留的问题。

## OpenCode Plugin

`@gameforge/opencode-plugin` 1.18.3 第一版提供：

- `session.created`：检查 MCP 与 Relay并尝试显示提示；
- `gameforge_status`：只读返回 MCP 状态和 Task 计数；
- `session.idle`：再次读取 Relay，只在发现新的 completed Task 时显示完成通知；
- headless `opencode run` 没有 TUI 时，通知失败被安全忽略。

插件不 claim Task、不生成项目、不发布事件、不停止或完成 Run。OpenCode 官方没有稳定的 Plugin slash-command 注册 Hook，因此没有伪造该能力。

## 验证

- Plugin 类型检查、3 个测试和构建通过；
- Integrations 类型检查、4 个测试和构建通过；
- dry-run 在当前 Windows 仓库真实生成两份临时配置；
- `bun run check`：通过；
- `bun run test`：192 个测试通过；
- `bun run build`：通过，Phaser 主 chunk 保留已知大于 500 kB 警告；
- `bun install --frozen-lockfile`：193 个安装、266 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `bun run doctor`：`ok: true`；
- `git diff --check`：通过。
