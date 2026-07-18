# CodeArts 抖音小游戏完整本地 Run

## 结果

真实 CodeArts Agent 完成了 Task 创建、认领、规格、项目生成、玩法验收、LayaAir 构建和 Run 完成。Relay 与 MCP Audit 的权威摘要由 `benchmark capture` 机械生成到 `record.json`，不依赖 Agent 最终文本。

| 证据 | 结果 |
|---|---|
| CodeArts 命令 | 退出码 0；CLI 墙钟约 342.1 秒，Relay 事件窗口 268.782 秒 |
| Task | `completed`，`claimedBy: codearts`，语言 `zh-CN` |
| RunEvent | 6 个连续事件：started、capabilities、spec、gameplay、build、completed |
| GameSpec | `arcade`，45 秒，3 个收集物、2 个障碍、3 条命、移动速度 220 |
| 玩法验收 | 通过；类型获胜场景 `won`，超时场景 `lost` |
| LayaAir 构建 | CLI 3.4.0，14 个文件，主包与总包均 1,112,075 字节，无分包 |
| 平台权限 | 网络、登录、分享、广告、支付均关闭；允许域名为空 |
| 素材 | Manifest revision 0，0 个外部素材；媒体 Provider 0 次 |
| MCP Audit | 16 次 GameForge MCP 调用、13 个唯一工具名，0 错误，未截断 |

MCP Audit 只保存工具名、相对顺序、耗时和结果，不保存输入或返回值。提交的 `record.json` 进一步只保留严格白名单：Task/Run 标识、事件计数、工具摘要、玩法场景、构建计数和相对证据路径；它不包含 Prompt、日志、模板哈希、平台域名、宿主输出路径、凭据或会话正文。

## Agent 纪律观察

- CodeArts 正常调用一次内置 `skill` 工具；该调用不属于 GameForge MCP Audit。
- 尽管任务要求不使用 shell，CodeArts 仍调用一次受沙箱约束的 `bash`，用途仅为生成 ISO 时间。网络被沙箱拒绝，未通过该调用修改仓库。
- 最终文本暴露了被忽略项目的本机绝对输出路径；提交记录不保留该值。
- CodeArts 宿主初始化再次重写 `.codeartsdoer/AGENTS.md`；实验后由工作树检查发现并恢复。

以上计为三项人工干预和一组 Agent 纪律问题，但不把已成功且可机械证明的生产 Run 标记为失败。后续提示词应提供确定性时间来源，并继续禁止最终文本回显绝对路径。

## 证据边界

本实验只证明：真实 CodeArts CLI 能通过 GameForge MCP 完成无 GUI 的本地抖音小游戏规格、生成、玩法逻辑验收与 LayaAir 静态构建。它没有证明 Canvas 视觉质量、抖音开发者工具导入、设备运行、账号能力、上传、审核或发布。

## 验证

- benchmark 定向严格类型检查：通过
- benchmark 测试：14 项通过
- Relay 回放：sequence 1–6 连续，终态 `run.completed`
- MCP Audit：已绑定同一 Task/Run，16 次调用、0 错误、未截断
- `bun install --frozen-lockfile`：200 个安装、282 个包，无变更
- `bun run check`：整仓严格检查通过
- `bun run test`：364 项测试通过
- `bun run build`：整仓生产构建通过
- `bun run bundle:check`：游戏与 Workbench 均在版本化预算内
- `bun run audit`：0 个已知生产依赖漏洞
- 基础 `bun run doctor`：`ok: true`，Provider 与工程能力均按无配置状态关闭
- 配置受管输出根与 LayaAir CLI 后再次 `bun run doctor`：`ok: true`，生成、玩法验收和抖音/微信构建能力均就绪
- `git diff --check`：通过
