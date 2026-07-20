# 实验结果

## 真实 CodeArts 产物

对既有 CodeArts 抖音小游戏产物连续执行两次：

```text
bun run --silent minigame:handoff -- --project-id codearts-douyin-arcade-20260718-2217 --target douyin-mini-game <绝对产物目录>
```

两次均退出 0，stdout 可直接由 JSON 解析器消费，没有 workspace 构建日志混入。脱敏摘要为：

```json
{
  "platform": "douyin-mini-game",
  "passed": true,
  "projectId": "codearts-douyin-arcade-20260718-2217",
  "fileCount": 14,
  "totalBytes": 1112075,
  "aggregateSha256": "ccfe4dc96e1c3bd5fa9f475754be37e251ae8a54484f143aca6d1e3351975fb2",
  "remoteOperations": "forbidden",
  "devToolVerification": "not-run",
  "deterministic": true,
  "absolutePathAbsent": true
}
```

## 安全与一致性

- 每个文件通过打开句柄以 64 KiB 分块计算 SHA-256；读取前后复核 device、inode、大小、mtime、ctime 与 realpath；
- 目录拒绝符号链接、特殊条目、非规范相对路径、大小写冲突、超过 4096 个文件或 20 MiB 总量；
- 先生成快照，再运行完整 mini-game validator，再生成第二快照；聚合摘要变化会返回非零；
- 聚合摘要覆盖 schema、项目、target、固定 artifact root、引擎版本、文件顺序/大小/哈希和本地边界字段；
- MCP 响应剥离 builder 的绝对 `outputPath`，完整 `handoff.files` 仍全部为相对路径；RunEvent 只保存聚合摘要；
- Lite 命令 `tmg open <project> --mode=lite` 不在本实验或 MCP 工具面中；它会启动 IDE，不是 headless 验收。

该读取器不是同机恶意并发写入的沙箱。产物根必须位于当前用户控制的受信任目录，取证期间不得由其他进程替换；独立 CLI 接受任意符合 `release/bytedancegame` 或 `release/wxgame` 形状的绝对目录，而受管目录边界由 MCP builder 额外校验。

该清单证明“被 validator 检查的本地产物在取证窗口内没有漂移”，不证明渲染、模拟器、真机、平台登录或商业发布条件。

## 定向验证

- `@gameforge/contracts`：61 项通过；
- `@gameforge/minigame-validator`：31 项通过；
- `@gameforge/tui`：18 项通过；
- `@gameforge/mcp-server`：59 项通过；
- 根 `minigame:handoff` JSON 管道：真实 14 文件产物通过。

## 完整门禁

- `bun install --frozen-lockfile`：200 installs / 282 packages，无变更；
- `bun run check`：通过；
- `bun run test`：389 项通过；
- `bun run build`：通过；
- `bun run bundle:check`：game 与 Workbench 均在预算内；
- `bun run audit`：无已知生产依赖漏洞；
- 隔离未配置环境的 `doctor:douyin`、MCP `doctor`、`doctor:browser` 与 `doctor:desktop`：全部通过；
- `git diff --check`：通过。

Vite 仍报告 Phaser 异步主 chunk 大于 500 kB；bundle budget 已通过，这不是本实验引入的失败。
