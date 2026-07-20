# 核心玩法参数结果

## 实现

- GameSpec 新增可选严格 `gameplay`；
- 百炼请求 JSON Schema 将 gameplay 设为必填且禁止额外字段；
- 生成模板以旧默认值兼容历史规格，以新参数控制实际 collectible/hazard spawn、starting lives 和 arena/platformer movement speed；
- 生成器版本升级为 0.3.0；
- Workbench 规格面板增加四项数值，Scene Graph 增加玩法摘要和 Movement 节点，地图特征数量按规格派生。

## 真实运行时证据

使用 `bun experiments/2026-07-17-gameplay-tuning/verify-runtime.ts` 生成项目；由于目录只允许新建，该命令用于首次生成。随后构建 verifier，并使用项目规定的 Node runtime：

```powershell
bun run --filter @gameforge/game-verifier build
node experiments/2026-07-17-gameplay-tuning/verify-generated.mjs
```

真实系统 Chrome 返回 `passed: true`：

- `lives: 1`；
- collectibles 恰好 2 个；
- hazards 恰好 0 个；
- 0.3.0 样例 manifest 明确记录 `generatorVersion: 0.3.0`；
- 右键 hold 500ms 后玩家 x 从 120 到 275，位移 155px，与 300 px/s 规格及帧边界容差一致；
- Canvas 960×540；
- console errors、page errors、failed requests 均为 0；
- 动作数 1，验收耗时 3152ms。

## 验证结果

- 目标测试：contracts 36、providers 22、generator 7、Workbench 29，全部通过；
- `bun run check`：通过；
- `bun run test`：157 个测试通过，`apps/game` 无测试文件并按既有配置返回 0；
- `bun run build`：通过；Phaser 主 chunk 仍有已知 500 kB 警告，不是构建失败；
- `bun install --frozen-lockfile`：检查 171 个安装、239 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过；
- 端口 4173、5173、8787：无残留监听。

## 边界

- puzzle 使用逐格移动，movementSpeed 只影响连续移动的 arena/platformer；
- 参数仍是固定模板的有界调优，不等同于任意自定义玩法 DSL；
- 尚未用真实百炼账号验证模型是否稳定生成合理难度值。
