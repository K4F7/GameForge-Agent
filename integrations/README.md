# CodeArts 与 OpenCode 集成

两个启动器共享 `integrations/shared/runtime.ts`，从自身目录向上定位仓库根，动态创建：

- 默认项目输出目录：`.gameforge-validation/integrations/projects/`；
- 临时 OpenCode 配置：`.gameforge-validation/integrations/<client>/opencode.json`；
- 默认 Relay：`http://127.0.0.1:8787/`。
- 每客户端 MCP 审计目录：`.gameforge-validation/integrations/<client>/mcp-audit/`，每次 MCP 启动生成唯一文件；

这些文件均被根 `.gitignore` 排除。启动器不修改用户全局配置，不读取认证存储，也不把环境变量值写入日志。

```powershell
bun run build
bun run dev:local
bun run codearts
bun run opencode
```

使用 `bun run codearts -- --dry-run` 或 `bun run opencode -- --dry-run` 会生成忽略目录中的临时配置并打印本地运行计划，但不启动客户端。计划不含凭据，不过会显示客户端、仓库、输出目录和临时配置的绝对路径，因此不应直接粘贴到公开日志。

可选环境变量：

- `GAMEFORGE_PROJECT_OUTPUT_ROOT`：绝对输出目录；
- `GAMEFORGE_RUN_RELAY_URL`：HTTPS 或 loopback HTTP；
- `GAMEFORGE_RUN_RELAY_TOKEN`：可选 Relay Bearer；临时配置只保存 `{env:GAMEFORGE_RUN_RELAY_TOKEN}` 引用，不写入真实值；
- `GAMEFORGE_MCP_AUDIT_DIR`：可选绝对审计目录；未配置时使用上述忽略目录；
- `CODEARTS_BIN` / `OPENCODE_BIN`：客户端可执行文件；
- Provider 密钥仍由用户安全环境提供，启动器不生成、不保存。

CodeArts 启动器在 Windows 先发现 `%USERPROFILE%\.codeartsdoer\installers\bin\codearts.exe`，不存在时回退到官方安装生成的 `%USERPROFILE%\.codeartsdoer\installers\codearts.cmd` shim，并通过 `ComSpec` 启动；两种方式都复用用户已有 OAuth 数据目录。shim 路径与参数逐项加引号，包含 cmd 元字符的参数会被拒绝并提示改用 `CODEARTS_BIN` 指向 exe。`--dry-run` 会显示实际发现的客户端路径但不启动进程。OpenCode 启动器默认调用 PATH 中的 `opencode`。正式 MCP 始终由 Node 承载，启动器自身由 Bun 执行。
