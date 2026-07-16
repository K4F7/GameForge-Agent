# 浏览器验收事件结果

## 已实现

- `verification.ready` 严格记录 projectId、passed、outcome、score、lives、remainingSeconds、Canvas、三类诊断计数、动作数、耗时及项目内 evidencePath；
- evidencePath 只允许 `.gameforge/verification/<安全文件名>.png`，绝对路径被契约拒绝；
- `GameVerifier` 保留完整 `screenshotPath`，同时返回可发布的相对 `evidencePath`；
- Relay 快照恢复覆盖验收事件；
- Workbench 新增 Browser Proof 卡片，新 Run/reset 会按既有状态初始化清空旧报告；
- CodeArts Skill 要求发布摘要、保留完整 MCP 报告用于修复，并禁止把绝对路径和诊断全文写入事件。

## 浏览器证据

系统 Chrome 打开本地 Workbench 并运行结构化演示。第一次等待卡片在演示事件尚未播放到末段时超时；重新读取页面状态后，卡片已经唯一可见并显示：

```text
验收通过 · WON · 960 × 540
分数 5 · 生命 2 · 剩余 24s · 诊断 0
.gameforge/verification/demo-proof.png
12 个动作 · 2400 ms
```

页面浏览器 error/warning 日志为 0。该检查不冒充真实云调用。

## 验证结果

- 目标测试：contracts 33、game-verifier 10、Workbench 27、Run Relay 26、MCP Server 23，全部通过；
- `bun run check`：通过；
- `bun run test`：151 个测试通过，`apps/game` 无测试文件并按既有配置返回 0；
- `bun run build`：通过；Phaser 主 chunk 仍有已知 500 kB 警告，不是构建失败；
- `bun install --frozen-lockfile`：检查 171 个安装、239 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过；
- 端口 4173、5173、8787：无残留监听。

## 剩余边界

- Workbench 当前显示相对证据路径，不提供文件下载接口；本地文件访问继续受项目目录边界保护；
- 结构化事件只含诊断计数，修复所需全文来自当次 MCP 返回或本地实验报告；
- 真实 CodeArts IDE/CLI 尚未执行该发布步骤。
