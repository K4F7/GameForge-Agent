# 结果

## 包体

`bun run bundle:check` 实测：

- 示例游戏初始 JS：2,227 bytes raw / 1,076 bytes gzip；
- 异步 Phaser 游戏块：1,376,248 bytes raw / 358,154 bytes gzip；
- 总计：1,378,475 bytes raw / 359,230 bytes gzip；
- Workbench 初始 JS+CSS：308,383 bytes raw / 91,839 bytes gzip；
- 两个目标均在版本化预算内。

改造前示例游戏单入口为 1,376,946 bytes raw / 358,500 bytes gzip。拆分将首屏入口降低约 99.8%，但总 gzip 基本不变；Vite 对异步 Phaser 单块仍给出超过 500 kB 的诚实警告。

## 生成项目验证

生成器版本升至 0.7.0，输出 `src/main.ts` loader、`src/game.ts` 玩法和 Vite manifest 配置。全新 `lazy-loader-smoke` 项目：

- 首次和第二次 `bun install` 因 registry `ConnectionClosed` 失败，未记录为通过；
- 使用仓库中相同锁定版本的已安装依赖做离线复核，直接执行 TypeScript 7.0.2 与 Vite 8.1.4，严格检查和生产构建通过；
- 生成产物初始 JS 约 2.22 kB，游戏异步块约 1.387 MB；
- GameVerifier 的系统 Chrome 会话分别在 30 秒和 120 秒启动上限超时，未伪造 verifier 通过；
- 独立应用内浏览器成功打开 `http://127.0.0.1:4317/`，`#game[data-state]` 为 `ready`，Canvas 为 960×540，语言为 `en-US`，截图显示英文 HUD、2 个目标、3 条生命和 30 秒计时，浏览器 warning/error 日志为空；
- 截图保存于忽略目录 `.gameforge-validation/performance-split/evidence/lazy-loader-ready.png`。

浏览器 smoke 证明动态模块能够加载并呈现游戏，但系统 Chrome verifier 启动超时仍是本机环境风险，不能用该 smoke 替代完整 won/lost 自动玩法验收。

## 整仓门禁

- `bun install --frozen-lockfile`：195 个安装项，无变更；
- `bun run check`：通过；
- `bun run test`：首次发现 Verifier 的旧断言仍要求 main 直接包含 Phaser；更新为同时验证 loader 动态导入和 game 模块 Phaser 重写后，整仓 203 项测试通过；
- `bun run build`：通过；
- `bun run bundle:check`：通过；
- `bun run doctor`：`ok: true`；
- `bun run audit`：0 vulnerabilities；
- `git diff --check`：通过。
