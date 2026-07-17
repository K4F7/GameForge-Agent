# CodeArts 客户端安全探测结果

## 安装与版本

- 可执行文件：`%USERPROFILE%\.codeartsdoer\installers\bin\codearts.exe`；
- 推荐启动 shim：`%USERPROFILE%\.codeartsdoer\installers\codearts.cmd`；
- `codearts.exe --version`：26.6.2；
- 当前 PATH 未包含安装目录，因此裸 `codearts` 不能由 `Get-Command`/`where` 发现；
- 探测时存在一个 `codearts.exe` 后台进程，其父进程为通过上述 shim 启动的 `cmd.exe`，但没有可自动化窗口或本地监听端口。

Windows 文件版本把可执行壳标识为 Bun 1.3.14；这不是 CodeArts 产品版本，产品版本以 CLI `--version` 为准。

## OpenCode 实现指纹

启动 shim 明确设置：

```text
KERNEL_DATA_DIR=%USERPROFILE%\.codeartsdoer\cli-data
KERNEL_CONFIG_DIR=%USERPROFILE%\.codeartsdoer
OPENCODE_CONFIG=%USERPROFILE%\.codeartsdoer\codearts_cli.json
OPENCODE_MODE=tui
SCENARIO=codeartsdoer
```

安装包依赖 `@opencode-ai/plugin` 26.6.2，主配置引用 `https://opencode.ai/config.json`。CLI 命令包含 `run`、`serve`、`mcp`、`agent`、`models`、session 和 export。这些是可复核的本机实现证据；探测未读取认证文件、权限文件或会话正文。

## CLI 与 MCP 状态

以下帮助命令成功：

```powershell
& "$env:USERPROFILE\.codeartsdoer\installers\codearts.cmd" run --help
& "$env:USERPROFILE\.codeartsdoer\installers\codearts.cmd" mcp --help
& "$env:USERPROFILE\.codeartsdoer\installers\codearts.cmd" agent --help
```

`codearts mcp list/add` 在当前 shell 返回认证失败，要求设置 `CODEARTS_CLI_AK`/`CODEARTS_CLI_SK`。本实验没有读取、申请、输入或持久化任何凭据。由于当前没有可连接的已登录 TUI/IDE 窗口，也没有本地 server 端口，真实 CodeArts MCP 配置和 GameForge Task 闭环尚未执行。

## 下一步验收

用户在自己的安全环境中完成 CLI AK/SK 配置，或打开已登录的 CodeArts 交互客户端后：

1. 启动 `bun run dev:local`；
2. 在 CodeArts 配置 `gameforge` stdio MCP，设置项目输出根和 loopback Relay URL；
3. Workbench 提交一个无敏感信息的 Task；
4. CodeArts 实际 list/claim/replay，使用手工合法 GameSpec 完成无云 Provider 链路；
5. 生成、预览、Chrome 验收并发布 `run.completed`；
6. 保存脱敏 Task/Run ID、工具摘要和 Workbench 截图。

当前结论：真实客户端安装和实现指纹已验证；真实 CodeArts Agent 执行 GameForge 工作流尚未验证。
