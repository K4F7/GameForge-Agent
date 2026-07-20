# 运行时图片尺寸归一化结果

## 实现

- 生成器升级为 0.5.0；
- 玩家和危险物统一使用 32×32 显示尺寸与 Arcade Physics body；
- 收集物统一使用 24×24 显示尺寸与 Arcade Physics body；
- Manifest 图片和程序化占位纹理共用同一创建路径；
- 背景图片继续按完整 960×540 游戏场景缩放，不参与角色碰撞体规则。

## 输入与调用

- 模型调用：0；
- 云 Provider 调用：0；
- Bun 脚本生成三张 256×256 RGBA PNG，经生产 Asset Store 分别写入 `player`、`collectible`、`hazard`；
- 系统 Chrome 验收动作：按住 ArrowRight 300ms；
- 人工干预：0。

## 独立工程与浏览器证据

生成项目自己的 `bun install`、`bun run check` 和 `bun run build` 全部通过。系统 Chrome 报告：

- `passed: true`，`status: running`；
- 玩家 x 坐标由 120 移动到 189.67；
- telemetry 包含 5 个收集物和 3 个危险物；
- Canvas 960×540；
- console errors、page errors、failed requests 均为 0；
- 1 个动作，耗时 3353ms。

人工复核 PNG 截图确认：256×256 青色玩家、黄色收集物和红色危险物均被缩小到预期相对尺寸，没有覆盖场景；HUD 和中文操作提示完整可见。

## 边界

- 本实验验证显示尺寸、运行状态、移动和源代码中的明确 body 尺寸，不评价 Seedream 图片的构图或透明背景质量；
- 固定方形显示尺寸会拉伸非方形角色图，因此 CodeArts 仍应为角色素材请求接近 1:1 的构图；
- 这里使用确定性本地 PNG，不声称调用或验证真实 Seedream 账号。

## 整仓验证

- `bun run check`：通过；
- `bun run test`：168 个测试通过，`apps/game` 无测试文件并按既有配置返回 0；
- `bun run build`：通过；Phaser 主 chunk 保留已知 500 kB 警告；
- `bun install --frozen-lockfile`：无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `bun run doctor`：真实 Node stdio MCP 握手通过；
- `git diff --check`：通过。
