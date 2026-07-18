# CodeArts 非交互 OAuth 复核

在用户升级客户端且已有 OAuth TUI 登录的前提下，重新验证 `codearts run --format json` 是否能复用 OAuth 完成一个无云 Provider 的 GameForge Task。

验收条件：记录实际版本、命令、退出码、认证结果、Task/Run 状态和清理；不读取或记录任何认证材料。
