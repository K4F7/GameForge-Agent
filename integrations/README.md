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

启动器自身把客户端工作目录固定到仓库根，因此生成的 OpenCode-compatible 本地 MCP 配置只使用官方列出的 `type`、`command`、`environment`、`enabled` 和 `timeout` 字段，不写非标准 `cwd`。直接复制 `opencode.json.example` 时也必须从仓库根启动客户端，或把 `command` 改为本机私有的绝对入口；不要把该绝对路径提交。

动态配置只在 `GAMEFORGE_RUN_RELAY_TOKEN` 完全未设置时省略认证引用。显式空白、换行或超出 32–512 字符范围会在客户端启动前失败，不能静默降级为无认证。

可选环境变量：

- `GAMEFORGE_PROJECT_OUTPUT_ROOT`：绝对输出目录；
- `GAMEFORGE_RUN_RELAY_URL`：HTTPS 或 loopback HTTP；
- `GAMEFORGE_RUN_RELAY_TOKEN`：可选 Relay Bearer；临时配置只保存 `{env:GAMEFORGE_RUN_RELAY_TOKEN}` 引用，不写入真实值；
- `GAMEFORGE_MCP_AUDIT_DIR`：可选绝对审计目录；未配置时使用上述忽略目录；
- `GAMEFORGE_LAYAIR_CLI`：可选 LayaAir CLI 3.4.0 入口；必须是绝对、已存在、非符号链接的普通文件，路径只写入被忽略的临时配置；
- `GAMEFORGE_DOUYIN_MINIGAME_CLI`：可选 `tt-minigame-ide-cli` 2.1.1 包内的 `bin/tmg.js`；相同路径约束，只允许 MCP 以当前 Node 执行 `--version` 探针；
- `CODEARTS_BIN` / `OPENCODE_BIN`：客户端可执行文件；
- Provider 密钥仍由用户安全环境提供，启动器不生成、不保存。

CodeArts 启动器在 Windows 先发现 `%USERPROFILE%\.codeartsdoer\installers\bin\codearts.exe`，不存在时回退到官方安装生成的 `%USERPROFILE%\.codeartsdoer\installers\codearts.cmd` shim，并通过 `ComSpec` 启动；两种方式都复用用户已有 OAuth 数据目录。shim 路径与参数逐项加引号，包含 cmd 元字符的参数会被拒绝并提示改用 `CODEARTS_BIN` 指向 exe。`--dry-run` 会显示实际发现的客户端路径但不启动进程。OpenCode 启动器默认调用 PATH 中的 `opencode`。正式 MCP 始终由 Node 承载，启动器自身由 Bun 执行。

启动器只在显式设置 `GAMEFORGE_LAYAIR_CLI` 时注入该变量；未设置时不猜测用户目录或 PATH，显式空白则 fail-closed。动态配置先拒绝相对路径、目录、缺失文件和符号链接，MCP 启动后再验证版本必须精确为 3.4.0。官方 dispatcher/wrapper 只用于定位安装：Builder 核验 `versions.json`、`Resources/package.json` 和固定 `Resources/cli-main.js`，随后用当前 Node、`shell: false` 直接运行主入口，不执行 `.cmd` 或继承用户 PATH。该入口只供受限的抖音/微信构建工具使用，不开放任意命令参数。

`GAMEFORGE_DOUYIN_MINIGAME_CLI` 同样只在显式设置时注入。其 `get_douyin_mini_game_cli_status` 工具只以当前 Node 执行 `bin/tmg.js --version` 并要求 2.1.1；`tmg version` 会查询线上项目版本，明确不使用。小游戏 CLI 的登录、打开、配置、项目 version、`build-npm`、`preview` 和 `upload` 都不暴露。小程序 `tt-ide-cli`/`tma` 不被接受。当前用户策略禁止平台 preview、上传、提审和发布，因此该适配只证明本机前置可发现，不冒充 DevTool 或真机验收。
