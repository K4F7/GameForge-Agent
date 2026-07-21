# GameForge Web 验收矩阵

状态：accepted
日期：2026-07-21
适用版本：`0.1.x`

## 证据等级

| 证据 | 允许声明 | 不允许推断 |
|---|---|---|
| 类型检查与静态检查 | `check passed` | 可运行、玩法正确 |
| 单元/集成测试 | `tests passed` | 浏览器视觉正确 |
| 生产构建 | `build passed` | 玩法、视觉或发布就绪 |
| Chrome 玩法验证 | `browser gameplay passed` | 所有视觉细节正确、平台可发布 |
| Chrome 视觉验证 | `visual verification passed` | 游戏规则完整、真机通过 |
| 真实 CodeArts Task/Run | `CodeArts loop passed` | 所有模板普遍可靠 |
| 平台 DevTool/真机 | 当前不适用，状态 `paused` | Web 证据不得冒充平台证据 |
| 生产发布 | 当前无此证据 | 当前不得使用 `production-ready` 或“可发布” |

## 当前 Web MVP 门槛

| 能力 | Alpha | Beta | RC | Stable |
|---|---:|---:|---:|---:|
| OpenChamber 只读兼容探针 | 必须 | 必须 | 必须 | 必须 |
| 真实 OpenChamber 提示提交 | 目标 | 必须 | 必须 | 必须 |
| 真实 CodeArts + MCP Task/Run | 目标 | 必须 | 必须 | 必须 |
| `arcade` 创建闭环 | 目标 | 必须 | 必须 | 必须 |
| 显式 `projectId` 修改闭环 | 目标 | 必须 | 必须 | 必须 |
| 五种 Web 模板回归 | 可部分 | 可部分 | 必须 | 必须 |
| `check/test/build/workbench:smoke` | 持续执行 | 必须 | 必须 | 必须 |
| 外部 Provider | 不包含 | 不包含 | 不包含 | 不包含 |
| 平台/DevTool | `paused` | `paused` | `paused` | `paused` |

## 终态规则

- Session idle 不等于 Run completed；
- 进程退出码 0 不等于 Agent 执行成功；
- `build passed` 不等于 `browser gameplay passed`；
- Canvas 存在不等于视觉验证通过；
- 一次黄金任务通过不等于五种模板全部通过；
- 只有对应命令和真实实验实际执行后才能记录为通过。
