# CodeArts 与 OpenCode 抖音小游戏同任务对比

## OpenCode 干净 Run

OpenCode 1.18.3 使用 `opencode/hy3-free` 完成与 CodeArts 相同的中文抖音街机收集任务。最终结论以 Relay、绑定 MCP Audit 和 `opencode.record.json` 为准，不以 Agent 文本为准。

路由的 `explicit-user-override` 来源取自被忽略的 OpenCode JSON 事件；提交的 record 只保存实际模型 ID 和成功的 `get_agent_model_route` 调用，不保存工具返回正文。

| 证据 | 结果 |
|---|---|
| OpenCode 命令 | 退出码 0；CLI 墙钟 92.181 秒，Relay 事件窗口 69.828 秒 |
| 模型路由 | `tencent` / `opencode/hy3-free`，`explicit-user-override` |
| Task | `completed`，`claimedBy: opencode`，语言 `zh-CN` |
| RunEvent | 6 个连续事件：started、capabilities、spec、gameplay、build、completed |
| GameSpec | `arcade`，45 秒，3 个收集物、2 个障碍、3 条命、移动速度 220 |
| 玩法验收 | 通过；类型获胜场景 `won`，超时场景 `lost`，131 毫秒 |
| LayaAir 构建 | CLI 3.4.0，14 个文件，主包与总包均 1,112,087 字节，无分包 |
| 素材 | Manifest revision 0，0 个外部素材；媒体 Provider 0 次 |
| MCP Audit | 16 次调用、13 个唯一工具，0 错误，未截断 |
| 内置修改工具 | bash/edit/write/patch 均拒绝；最终文本未出现绝对路径 |

## 发现与修正

正式记录之前保留了两个忽略的模型探针和一个发现 Run：

- MiMo V2.5 免费 target 在 79.138 秒后返回上游 HTTP 400，没有创建 Task 或调用 MCP；
- Hy3 免费 target 在 13.905 秒内完成无工具 `READY` 探针，OpenCode 报告成本为 0；
- 首个 Hy3 生产 Run 虽完成玩法与构建，但共有 21 次工具调用：模型路由在 MCP 参数校验前失败 1 次，Audit 内另有 4 次字符串化 GameSpec 校验错误和 1 次 create apply 误用 update CAS。该 Run 不进入对比 record。

据此完成三项修正：把腾讯 Hy3 精确 host target 加到 DeepSeek/GLM 之后的跨宿主 fallback；让 `validate_game_spec` 的 MCP 输入 Schema 明确暴露 JSON object，同时保留残缺对象的结构化 issues；修正实验提示，使 create apply 不再携带仅 update 可用的 `expectedPlanSha256`。随后在全新 Relay、项目和 Audit 中一次得到 16/16 成功调用。

## 比较边界

`comparison.generated.md` 只在 definition fingerprint 相同且两端都具备 passed gameplay/build proof 时标记工作流可比较。CodeArts 包为 1,112,075 字节，OpenCode 包为 1,112,087 字节；12 字节差异不作为模型质量指标。墙钟耗时也包含不同宿主启动、模型推理和工具编排开销，只是本次样本，不代表通用排行榜。

两次成功 Run 都只证明程序化素材下的本地规格、受管生成、无渲染玩法逻辑和 LayaAir 静态构建。它们都不证明视觉质量、抖音 DevTool、真机、账号能力、上传、审核或发布，也没有验证付费媒体 Provider。

## 验证

- OpenCode JSON 事件：16 次工具调用、0 错误、无内置修改工具调用
- Relay：Task completed，sequence 1–6 连续
- MCP Audit：同 Task/Run 绑定，16 次调用、0 错误、未截断
- Benchmark capture：`opencode.record.json` 通过严格 Schema 与 definition fingerprint 校验
- Benchmark report：`comparison.generated.md` 判定同一任务定义且工作流质量可比较
- `bun install --frozen-lockfile`：200 个安装、282 个包，无变更
- `bun run check`：整仓严格检查通过
- `bun run test`：367 项测试通过
- `bun run build`：整仓生产构建通过
- `bun run bundle:check`：游戏与 Workbench 均在版本化预算内
- `bun run audit`：0 个已知生产依赖漏洞
- `bun run doctor`：`ok: true`，无配置能力按预期关闭；正式 Run 前的完整工程配置 doctor 同样为 `ok: true`
- CodeArts/OpenCode 临时配置均已恢复为 `gameforge_*: ask`，无精确 allow；隔离 Relay 已关闭
- `git diff --check`：通过
