# 实验结果

状态：契约、持久化和界面投影通过。

新增 `build.ready` 只接受：项目 ID、固定 `douyin-mini-game` target、LayaAir 3.4.0、`passed: true`、文件/主包/总包/分包、方向、平台能力、允许域名、媒体 Manifest revision/count，以及 stdout/stderr 是否截断。Schema 拒绝未知字段，因此绝对 `outputPath` 不能进入事件；主包和总包再次受4/20 MiB边界约束。

`build_douyin_mini_game` 返回严格类型的无路径 `buildEvent` payload；CodeArts 只添加当前 Run 的 envelope 后发布，不再手工映射十余个字段。独立安全复核后，MCP 对外响应也完全移除 builder 内部的绝对 `outputPath`，单元测试同时确认顶层和 `buildEvent` 均无该字段。

Relay 持久化测试保存并重启恢复 `build.ready`；Workbench reducer 新 Run 会清空旧构建，构建卡显示 CLI、方向、文件、主包、总量、资产和 revision；TUI summary 显示同一核心摘要。CodeArts Skill 要求媒体落盘后执行一次平台构建并发布连续事件，恢复时以 projectId 与 Manifest revision 判断是否需要重建。

真实系统 Chrome Workbench smoke 已通过：Relay 回放连续到 sequence 15，页面可见“构建通过”和“LayaAir 3.4.0”，七阶段100%，preview iframe 正常，console/page/非预期 request 诊断均为0。截图复核确认构建卡与 Browser Proof 同时完整显示，没有遮挡七阶段时间线；证据位于忽略目录 `output/playwright/`。该实验验证协议、Relay 与 UI 链路，不代表 CodeArts 已用新事件重新完成一次真实抖音 Task，也不替代 DevTool/真机验收。
