# 实验结果

日期：2026-07-18

## 结果

CodeArts 启动目标解析已拆为可测试的纯集成模块。Windows 依次探测：

1. `%USERPROFILE%\.codeartsdoer\installers\bin\codearts.exe`；
2. `%USERPROFILE%\.codeartsdoer\installers\codearts.cmd`。

选择 cmd 时 child command 使用 `ComSpec /d /s /c`、单条显式引用的 `call` 命令和 `windowsVerbatimArguments`；含 cmd 元字符的路径/参数会在启动前拒绝并提示改用 exe，避免 shell 解释。显式 `CODEARTS_BIN` 与非 Windows PATH 行为保持不变。启动器继续动态生成隔离 `OPENCODE_CONFIG`，不修改 CodeArts 全局配置或 OAuth 数据。

本机 dry-run 实际发现：

```text
C:\Users\<user>\.codeartsdoer\installers\bin\codearts.exe
```

输出同时包含动态 repo/output/config 路径和 loopback Relay，但不含凭据；这些绝对路径仍是本机信息，不应复制到公开日志。dry-run 会写入忽略目录的临时配置，但没有打开第二个 TUI。cmd fallback 除纯解析测试外，还在 Windows 真机执行了一个位于含空格目录中的临时 `.cmd`，参数原样写入证据文件后清理。

## 验证

```text
bun install --frozen-lockfile
bun run check
bun run test                    # 226 tests passed
bun run build
bun run bundle:check
bun run doctor
bun run doctor:browser
bun run doctor:desktop
bun run audit                   # 0 vulnerabilities
bun run integrations:check
bun run integrations:test     # 9 tests passed
bun run codearts -- --dry-run
git diff --check
```

第一次严格检查因 `exactOptionalPropertyTypes` 拒绝显式传入 `string | undefined` 而失败；调用端改为仅在环境变量存在时展开字段，随后检查通过。

## 证据边界

- 本实验验证发现、命令构造和本机 dry-run，没有自动接管或启动 OAuth TUI；
- 真实 CodeArts GameForge 闭环证据仍以 `../2026-07-18-codearts-real-e2e/result.md` 为准；
- 非交互 CLI AK/SK、云媒体 Provider 与 OpenCode 免费模型限流不在本实验范围。
