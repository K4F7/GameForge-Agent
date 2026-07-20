# 结果

状态：等待账号环境变量与用户显式授权真实付费调用。

当前实现提供可执行的脱敏 smoke 编排，但本记录不把模拟 HTTP 测试、配置存在性检查或未执行命令写成真实云端通过。完成后应从 `.gameforge-validation/provider-smoke/evidence.json` 摘录 Provider、模型、耗时、工具调用、文件大小、SHA-256、人工干预与最终状态，不记录任何凭据、完整 jobHandle 或临时音频 URL。

## 2026-07-18 本地预检

- `bun run provider:smoke`：按预期退出 1，报告四类 Provider 的缺失变量名称，未打印变量值、未调用云 API，并写入忽略目录中的脱敏证据。
- `bun install --frozen-lockfile`：193 个安装项，无变更。
- `bun run check`：通过。
- `bun run test`：195 项测试通过。
- `bun run build`：通过；仅保留 Phaser 主 chunk 超过 500 kB 的既有警告。
- `bun run doctor`：`ok: true`；无密钥环境下四类云能力均为 `ready: false`，符合预期。
- `bun run audit`：0 vulnerabilities。
- `git diff --check`：通过。

真实账号调用仍为 0；等待凭据通过 shell 注入，并由用户显式执行带 `--execute` 的命令。
