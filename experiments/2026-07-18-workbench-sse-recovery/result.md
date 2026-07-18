# 实验结果

日期：2026-07-18

## 实现结果

新增 Workbench 恢复连接控制器，状态为 replaying、waiting、connected、terminal 或 failed。它将 JSON replay 与 EventSource 生命周期统一绑定到单一连续游标：只有事件成功交给 UI reducer 后游标才前进；重复 sequence 被忽略，跳号会关闭旧流并立即回放。

网络错误使用 500、1000、2000、4000、8000 ms 退避；每次重试都从当前游标重新回放。HTTP 409/410 直接失败，避免永远重试无效游标。自动预算耗尽后保留控制器和游标，Workbench 顶部与 Relay 卡片显示“恢复连接”，由用户显式重置重试预算。`run.completed`、`run.stopped` 或不可修复 `phase.failed` 会关闭 stream。

该恢复控制器只执行 Relay 的 GET replay 与 SSE 连接，不认领 Task、不调用 MCP、不调用模型，因此没有改变“CodeArts 是主智能体”的架构边界。

## 测试证据

- gap 场景：初始游标 1 收到 sequence 3，旧 EventSource 关闭；`after=1` 回放 sequence 2，再建立新流并接收 sequence 3；最终 cursor=3、无重复；
- retry 场景：注入 5/10 ms 测试退避，验证严格两次调度后 failed；
- cursor expired：HTTP 410 直接拒绝 ready，调度器未调用；
- Windows/Node 定时器句柄类型差异由可注入 opaque scheduler handle 处理。

## 真实浏览器验证

按 `game-studio:game-playtest` 检查流程，使用 Playwright CLI、1440×1000 Chrome 桌面视口与启用持久化快照的真实 Relay：

1. Workbench 提交真实 `/tasks` 请求，取得 Task 回执并连接 cursor 1；
2. 强制停止本次实验启动的 Relay 监听进程；约 700–900 ms 后 UI 显示 connecting 和“从游标 1 回放/有限重试”，Run ID、Task ID 与运行状态保持不变；
3. 使用同一 state file 重启 Relay；Workbench 无点击自动恢复 connected，仍为 cursor 1；
4. 两次停止/重启均成功恢复，没有生成重复日志或轮换 Run ID；
5. Relay 状态文案暴露为 `role=status`，错误耗尽时使用 `role=alert`。

截图：[`retrying.png`](./retrying.png) 展示中继离线后的恢复态；[`recovered.png`](./recovered.png) 展示同一 Run 自动恢复连接。

浏览器检查同时发现并关闭了两个既有前端问题：严格 CSP 曾阻断 Vite React 开发 preamble，IPv6 wildcard host-source 被 Chrome 判为无效。现在只有 development server 放行 Vite 必需 inline script/style，生产仍严格；动态地图/进度不再使用 inline style。opaque sandbox 中的 Vite 游戏 module 需要 CORS，受控 preview runtime 与示例游戏已在 IPv4 loopback 上显式开启 CORS。针对当时已经运行的旧 MCP preview 进程，浏览器仍记录其旧响应缺少 CORS；本实验未终止该非本轮启动进程，新 runtime 由测试验证响应头。

## 最终门禁

```text
bun install --frozen-lockfile
bun run check
bun run test                 # 232 tests passed
bun run build
bun run bundle:check
bun run doctor
bun run doctor:browser
bun run doctor:desktop
bun run audit                # 0 vulnerabilities
git diff --check
```

为响应独立复核，新增异步测试不再依赖 Vitest 专属 `vi.waitFor`。额外使用 Bun 内置 runner 直接执行 run-client、preview-security 和真实 Vite runtime 三个文件，结果为 23 passed、0 failed。生产 `dist/index.html` 已检查：CSP 不含 `unsafe-inline` 或无效 IPv6 source，源码不再含 React `style=`。Workbench 体积仍在版本化预算内（310087 raw / 92306 gzip）。

## 剩余边界

- Relay 每个 Run 默认只保留 10000 条事件；410 表示所需历史已被截断，客户端不能伪造恢复；
- 浏览器刷新仍从当前输入的 Run ID 由零回放，不持久化 UI 私有游标；
- 此条历史边界已由 `experiments/2026-07-18-shared-run-recovery/` 关闭：Workbench 与 TUI 现复用 `@gameforge/run-relay/recovery`，只保留各自传输适配。
