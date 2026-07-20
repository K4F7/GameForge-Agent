# 实验结果

## 执行窗口与调用

- 执行窗口：2026-07-16 17:29–17:40，追加 lost 验收约 21:28–21:30（Asia/Shanghai）。
- 真实 `GameVerifier.verify` 调用：9 次。
- 额外诊断会话：最小 Chrome 启停 1 次、受控 Vite/页面诊断 1 次。
- 云 Provider/MCP 媒体调用：0。
- 人工中途干预：0。

## 问题与修复

1. Bun runtime 启动 Playwright 超时；改为正式 Node MCP runtime 后 Chrome 正常启动。
2. 页面 readiness 超时。诊断发现 verifier 用 `createRequire().resolve("phaser")` 选中了 UMD `dist/phaser.js`，浏览器默认 ESM import 失败。
3. 改为 Phaser 包官方 `exports.import` 对应的 `dist/phaser.esm.js`；同时让 readiness 失败保留有界 console/page/request 诊断。
4. 初始 running 烟测通过。两次仅靠截图推断的 won 脚本分别得到 `score=0/lives=2` 和 `score=4/lives=3`，均如实保持 `passed=false`。
5. 生成器升级为 0.2.0，向只读状态增加玩家、剩余收集物和危险物坐标。新项目独立 Bun 安装、检查和构建通过；telemetry 驱动的 11 步有限脚本达到 won。
6. 对同一 0.2.0 项目执行 6 次 10 秒等待和 1 次 2 秒余量动作；倒计时归零后返回显式 lost，Verifier 没有进行动作规划或自动重试。
7. 人工查看 0.2.0 lost 截图时发现结构化状态为 0 秒、终态遮罩已出现，但 HUD 仍保留上一帧的 `1s`。根因是统一 `finish()` 未在终态同步 HUD；这也可能让 won 或生命归零画面保留上一帧分数/生命。模板在 `finish()` 设置 `ended` 后调用 `updateHud()`，生成器升级为 0.2.1。
8. 以最短合法 30 秒规格生成全新 `lost-hud-smoke`，独立执行 `bun install`、`bun run check` 和 `bun run build` 后，真实 Chrome lost 验收通过，截图明确显示 `0s`。

## 通过证据

### Running

- `passed: true`
- 状态：`running`
- Canvas：960 × 540
- 初始玩家：`(120, 270)`
- 剩余收集物：5
- 生命：3
- console/page/request 诊断：0/0/0
- 截图：`.gameforge-validation/telemetry-smoke/.gameforge/verification/2aed2eaf-fd19-4ad9-bb8f-f5e36e40341c.png`

### Won

- `passed: true`
- 状态：`won`
- 分数：5
- 剩余收集物：0
- 生命：3
- 剩余时间：约 53.94 秒
- 动作：11
- 时长：约 9.18 秒
- console/page/request 诊断：0/0/0
- 截图：`.gameforge-validation/telemetry-smoke/.gameforge/verification/246e17b1-55b7-4af1-bc2e-42c30494531b.png`

### Lost

- `passed: true`
- 状态：`lost`
- 明细：`The timer reaches zero.`
- 分数：0
- 生命：3
- 剩余时间：0
- 剩余收集物：5
- 危险物：3
- 动作：7（6 × 10 秒等待 + 2 秒余量；终态后结束）
- 时长：约 64.84 秒
- console/page/request 诊断：0/0/0
- 截图：`.gameforge-validation/telemetry-smoke/.gameforge/verification/6336e14a-b023-474c-927a-4101956b42a1.png`
- 人工查看截图确认中央显示“任务失败”和 `The timer reaches zero.`。右上角 HUD 仍显示取整后的 `1s`，而权威测试状态已为 `remainingSeconds: 0`；这是终态帧的显示时序差异，不影响 lost 判定，但保留为视觉细节。

### Lost HUD 修复（生成器 0.2.1）

- 项目：`.gameforge-validation/lost-hud-smoke`
- `passed: true`
- 状态：`lost`
- 剩余时间：0
- HUD：人工确认右上角显示 `0s`
- 动作：4（3 × 10 秒等待 + 2 秒余量）
- 时长：约 35.38 秒
- console/page/request 诊断：0/0/0
- 独立 Bun 安装、严格检查和生产构建：通过
- 截图：`.gameforge-validation/lost-hud-smoke/.gameforge/verification/7dfbbf00-f0e1-4598-9e3f-9898592822ef.png`
- 修复后整仓门禁：严格检查、130 个测试、构建、冻结锁安装、0 漏洞审计和 diff 检查全部通过。

## 尚未证明

- 未使用应用内浏览器；上述证据来自仓库 verifier 驱动的真实系统 headless Chrome。
- 未运行真实 CodeArts IDE/CLI，也未调用百炼、Seedream、豆包语音或 Freesound 云账号。
