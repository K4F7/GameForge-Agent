# 结果

## 根因

- Node 24.18.0 + Playwright 1.61.1 + `channel: chrome` 最小探针：398 ms 成功；
- Bun 1.3.14 直接承载相同探针：外层 44 秒命令上限超时，Playwright 30 秒 launch timeout 没有可靠返回；
- 之前失败的手工 GameVerifier 使用了 `bun -e`，而生产 MCP 按设计使用 `node packages/mcp-server/dist/index.js`；
- Node 启动恢复后，旧 ready 探针仍用 2D Canvas 读取 Phaser WebGL framebuffer。默认 framebuffer 合成后读回为统一黑色，即使 HUD、telemetry 和截图实际正常，因此继续等待到超时。

## 修复

- Bun 直接承载系统 Chrome 时在 launch 前立即返回明确错误；
- Chrome launch 增加 30 秒内部 timeout；
- 配置可执行路径时先检查可访问性；
- browser 已创建后，context/page/route 任一步骤失败都会关闭 browser；
- 总超时覆盖 server、browser、navigation、ready、动作、状态读取与截图；server/session 在外层超时后迟到完成时也会立即执行清理；
- ready 改为完整 telemetry + Canvas 内部/布局尺寸 + display/visibility/opacity；视觉证据仍由随后截图保存；
- 新增 `bun run doctor:browser`，由 Bun 编排构建、Node 执行 Chrome 探针。
- browser doctor 只输出稳定问题码和通用消息，不回显 Playwright 中可能包含的本机绝对路径。

## 真实证据

- `doctor:browser`：Node 模式、`channel:chrome`、616 ms、`ok: true`；
- 修复后以 Node 对 `lazy-loader-smoke` 执行真实 GameVerifier：2,307 ms，passed true、running、Canvas 960×540、score 0、lives 3、2 个 collectible、0 hazard，console/page/request diagnostics 均为 0；
- 截图：`.gameforge/verification/c8f37502-1f6a-47f8-9b75-994263db6aca.png`（位于忽略的生成项目目录）。

本实验没有终止或读取现有用户 Chrome 会话。Bun 仍是仓库包管理器和命令入口，只是不作为 Playwright 品牌 Chrome 的进程运行时。

增强清理后再次执行 doctor 为 636 ms、`ok: true`；GameVerifier 包 15 项测试覆盖 Bun fail-fast、配置路径、启动失败清理、迟到资源清理和 doctor 脱敏分类。

## 整仓门禁

- `bun install --frozen-lockfile`：195 个安装项，无变更；
- `bun run check`：通过；
- `bun run test`：213 项通过；
- `bun run build`、`bun run bundle:check`：通过；
- `bun run doctor`：`ok: true`；
- `bun run doctor:browser`：661 ms、`ok: true`；
- `bun run audit`：0 vulnerabilities；
- `git diff --check`：通过。
