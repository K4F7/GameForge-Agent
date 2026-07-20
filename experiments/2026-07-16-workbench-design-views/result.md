# Workbench 设计视图结果

## 实现结果

- 新增纯函数 `createSceneNodes`，从 GameSpec 和运行时资产条目派生 Scene Graph；
- 场景树展示 Scene、World、Gameplay Systems、Audio，以及控制、胜负条件和八种运行时资产角色；
- 资产角色显示“已绑定”或“程序化/静音回退”；
- 新增 `createMapView`，为 arcade、platformer、puzzle、shooter、strategy 返回固定 11×6 模板布局；
- 页面将“地图编辑”改为“地图视图”，明确标注“模板示意 · 非关卡文件”。

## 浏览器证据

真实 Chrome 打开本地 Workbench，触发本地结构化演示后：

- 场景结构可见，共 15 个节点；演示资产中 1 个为真实绑定，7 个为明确回退；
- 地图视图可见，容器约 558×507 CSS 像素；共有 66 个底层网格和 6 个 arcade 特征元素，包含唯一玩家与目标；
- 浏览器 console/error 诊断为 0；
- 裁剪截图请求在浏览器控制通道等待 5 秒后超时，因此不把截图列为通过证据；DOM 可见性、尺寸、节点和诊断检查均已成功返回。

## 验证命令与最终结果

- `bun run --filter @gameforge/workbench check`：通过；
- `bun run --filter @gameforge/workbench test`：4 个测试文件、26 个测试通过；
- `bun run --filter @gameforge/workbench build`：通过；
- `bun run check`：通过；
- `bun run test`：149 个测试通过，`apps/game` 无测试文件并按既有配置返回 0；
- `bun run build`：通过；Phaser 主 chunk 的 500 kB 警告仍存在，不是构建失败；
- `bun install --frozen-lockfile`：检查 171 个安装、239 个包，无变更；
- `bun run audit`：0 个生产依赖漏洞；
- `git diff --check`：通过；
- 端口 4173、5173、8787：无残留监听。

## 边界

- 地图是生成器类型模板的解释性视图，不是从 Phaser 运行时反序列化的关卡文件；
- 当前不支持拖拽编辑，避免在没有正式关卡 Schema 和确定性写入工具时制造不可审计变更；
- 浏览器使用内置演示事件，真实 Relay 数据仍由既有契约和集成测试覆盖。
