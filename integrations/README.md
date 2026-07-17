# CodeArts 与 OpenCode 集成

两个启动器共享 `integrations/shared/runtime.ts`，从自身目录向上定位仓库根，动态创建：

- 默认项目输出目录：`.gameforge-validation/integrations/projects/`；
- 临时 OpenCode 配置：`.gameforge-validation/integrations/<client>/opencode.json`；
- 默认 Relay：`http://127.0.0.1:8787/`。

这些文件均被根 `.gitignore` 排除。启动器不修改用户全局配置，不读取认证存储，也不把环境变量值写入日志。

```powershell
bun run build
bun run dev:local
bun run codearts
bun run opencode
```

使用 `bun run codearts -- --dry-run` 或 `bun run opencode -- --dry-run` 只生成并打印脱敏运行计划，不启动客户端。

可选环境变量：

- `GAMEFORGE_PROJECT_OUTPUT_ROOT`：绝对输出目录；
- `GAMEFORGE_RUN_RELAY_URL`：HTTPS 或 loopback HTTP；
- `CODEARTS_BIN` / `OPENCODE_BIN`：客户端可执行文件；
- Provider 密钥仍由用户安全环境提供，启动器不生成、不保存。

CodeArts 启动器在 Windows 默认发现 `%USERPROFILE%\.codeartsdoer\installers\bin\codearts.exe`，并复用用户已有 OAuth 数据目录；OpenCode 启动器默认调用 PATH 中的 `opencode`。正式 MCP 始终由 Node 承载，启动器自身由 Bun 执行。
