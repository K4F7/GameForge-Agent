# 实验结果

## 时间与干预

- 可复核执行窗口：2026-07-16 06:43–17:40（Asia/Shanghai）
- 人工中途干预：0
- 真实云 Provider 调用：0
- 真实 MCP 媒体调用：0
- 官方资料检索/只读审计：火山 TTS、Freesound、开源游戏 Agent、仓库安全边界、工作台与 E2E 缺口
- 本地工具：Bun 1.3.14、PowerShell、TypeScript、Vitest、Vite、Bun audit、独立项目生成器

平台没有导出统一的外层工具调用计数，因此不编造总数；上述分类和下面的实际命令构成本实验的可复核调用记录。

## 实际验证命令

```powershell
bun install --frozen-lockfile
bun run check
bun run test
bun run build
bun run audit
bun -e "<调用 GameProjectGenerator 生成 bun-preview-smoke>"
cd .gameforge-validation\bun-preview-smoke
bun install
bun run check
bun run build
git diff --check
```

## 结果

- 整仓严格 TypeScript 检查：通过。
- 自动化测试：127 个通过；`apps/game` 当前无单元测试文件，按 `--passWithNoTests` 返回 0。
- 整仓生产构建：通过。
- 独立生成项目 `bun-preview-smoke`：Bun 1.3.14 成功解析并安装 Phaser 4.2.1、TypeScript 7.0.2 和 Vite 8.1.4，随后严格 TypeScript 检查和 Vite 生产构建通过。
- Bun 对 npm 官方 registry 的生产依赖审计：0 个已知漏洞。
- 本轮审计前两次经本机 `127.0.0.1:7890` 代理发生 TLS `ConnectionClosed`；确认官方 registry 直连为 HTTP 200 后，仅对审计子进程清除代理环境并重跑成功。没有修改用户的全局代理配置。
- `git diff --check`：通过。
- 生成游戏主包约 1.385 MB、gzip 约 361 KB，Vite 报告大于 500 KB 的 chunk 警告；不是构建失败，但需要后续代码拆分。

## 已证明

- 固定 Phaser 模板、资产 Manifest、运行时媒体回退、Run Relay 和 MCP 工具可以在无云密钥时构建和测试。
- 百炼 Qwen GameSpec、Seedream、Freesound、火山异步 TTS 的模拟官方 HTTP 契约测试通过。
- TTS 作业工具不在 MCP 内轮询；签名句柄绑定项目，素材化执行一次查询和一次白名单下载。
- 生成游戏提供 `window.__GAMEFORGE_TEST__` 与 `gameforge:outcome`。`verify_game_project` 已接入 MCP，使用受控 Vite 配置、固定 Phaser 依赖、外部网络阻断、最多 100 步动作、显式超时、截图和结构化诊断。
- `start_game_preview`/`stop_game_preview` 已接入 MCP。真实集成测试完成“生成项目 → 受控 loopback Vite → HTTP 获取页面 → 关闭会话”；`preview.ready` URL 契约、Relay 转发和 Workbench 按运行切换状态均有自动化测试。
- Workbench Prompt 已接入 Relay Task 收件箱；真实 HTTP 集成测试完成“创建 Task+Run → RunRelayClient 列出 → CodeArts 身份认领 → 完成 Run → Task 同步终态”。MCP 提供有界列表、读取和原子认领工具，不包含模型调用或 Agent 循环。
- Workbench GameSpec 与资产面板已移除硬编码结果，只归约经过契约验证的 `spec.ready` 和 `asset.ready`；新 Run 会清空旧规格、素材和预览，模拟事件与状态测试覆盖相同路径。

## 尚未证明

- 没有真实 CodeArts IDE/CLI 运行证据。
- 没有真实百炼 Qwen、Seedream、豆包语音或 Freesound 账号调用，不能证明价格、延迟、结构化输出兼容性、音色/画质、实际 CDN 主机或账号许可。
- 当前环境仍没有可用的应用内浏览器；但仓库 `game-verifier` 已通过真实系统 headless Chrome 取得 running、won、键盘动作、Canvas 状态与 PNG 证据。两者不混同，详见独立浏览器实验记录。
- 尚未取得真实 CodeArts IDE/CLI 调用 `list_game_tasks`、`claim_game_task` 并完成后续生成/预览发布的端到端证据；当前证明的是 Workbench → Task Relay → MCP 客户端的工程链路。
- 21:14 补齐 `replay_game_run`：CodeArts 可在认领已有 Task 后或发布游标冲突时，通过 MCP 从显式游标读取一次最多 1000 条、严格 Schema 校验的事件页；客户端不轮询、不重试、不自动翻页。目标测试为 Relay 20 个、MCP 21 个，均通过。
- 21:19 新增无密钥本地工作流集成实验，真实串联 HTTP Task Relay、MCP Client、生成器和受控 Vite 预览；完整记录见 `experiments/2026-07-16-local-workflow-e2e/`。该证据不冒充真实 CodeArts IDE/CLI 或云 Provider 验收。
- 21:22 将生产 Asset Store 纳入同一实验：确定性图片测试替身的字节经过魔数、SHA-256、角色和 Manifest 校验后真实落盘，并原样发布 `asset.ready`；仍未声称调用了真实 Seedream。
- 21:26 将确定性 Freesound 与异步 TTS 测试替身纳入同一实验：音效和配音经生产 Asset Store 落盘，Manifest revision 依次达到 2/3，并发布两个连续 `asset.ready`；TTS 保持 submit/query/materialize 三次调用且不轮询。未声称调用真实云账号。
- 约 21:30 使用正式 Node/Playwright Verifier 对生成器 0.2.0 样例执行真实 lost 路径：倒计时归零，`passed=true`，浏览器诊断 0/0/0，截图人工确认“任务失败”。完整证据见 `experiments/2026-07-16-browser-telemetry/result.md`。
- 约 21:34 修复 lost 截图 HUD 保留上一帧 `1s` 的问题，生成器升级为 0.2.1；全新 30 秒样例独立 Bun 安装/检查/构建和真实 Chrome lost 验收通过，截图人工确认 `0s`。
- 约 22:10 真实系统 Chrome 验证 EventSource 在持久 Relay 重启后重新打开并收到下一条事件；Workbench 新增 open 游标回调，恢复 connected 提示且继续忽略回放重复事件。
- 约 22:15 生产 Relay 验证 Task 创建跨重启幂等：同 Run ID/Prompt/语言返回相同 Task 与原 `run.started`，异内容返回 `task_run_conflict`，任务数保持 1。
- 约 22:24 Workbench 新增唯一默认 Run ID、连接期输入锁定和显式“新任务”重置；真实 Chrome 验证提交/停止/轮换流程，截图确认右侧 `NO RUN` 且旧回执与阶段状态清空。
- 约 22:31 两个独立 MCP Client 会话验证 CodeArts 可恢复 `claimedBy=codearts` 的已认领 Task、幂等认领、回放已完成阶段并继续完成；Skill 改为 claimed-first 的一次无过滤快照。
- 约 22:40 新增 `voice.job.updated` 结构化事件：Client A 在 TTS submit 后发布 processing 与签名 job handle，Client B 从 Relay 回放恢复 handle 并完成一次 query；Workbench 只归约 projectId、assetId 和 status，不保存或显示 handle。该验证使用确定性替身，没有调用真实火山语音。

## 结论

媒体适配器、资产落盘、生成运行时、事件观察和本地真实 Chrome 验收的工程基线通过；整体“游戏 Agent”仍缺真实 CodeArts 与云 Provider 端到端证据。下一实验应由真实 CodeArts 认领 Workbench Task，完成 Prompt → GameSpec → 生成 → 云素材 → 构建 → 操作 → 胜负状态 → 预览发布。
