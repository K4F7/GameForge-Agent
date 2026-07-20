# Workbench 真实浏览器 Smoke 结果

## 最终结果

`bun run workbench:smoke` 成功；直接执行已构建 smoke 最终耗时约 3.4 秒。命令让三个服务直接监听系统分配的随机 loopback 端口，不经过“探测后释放再绑定”，并启动真实 Relay、生产 Workbench 静态服务和高对比受控预览页，由系统 Chrome 完成：

1. 填写游戏需求、选择 `en-US`、写入唯一 Run ID 并点击“提交给 CodeArts”；
2. Relay 收到真实 Task；fixture 以 `workbench-smoke` 身份认领；
3. 一次批量发布 sequence 2–13：GameSpec、一个 Freesound 契约资产、七个阶段完成、preview、verification 与日志；
4. `completeRun` 生成 sequence 14，Task 与 Run 进入终态；
5. Relay 从零回放并机器核验 sequence 1–14 严格连续；
6. 页面执行 11 项断言：Schema、标题、终态消息、资产数量、验收通过、100% 进度、七阶段成功、iframe URL/内容和连续回放；
7. 全页截图确认资产卡、WON Browser Proof 和可读预览同时显示；
8. console error、page error、意外 failed request 均为 0；终态主动关闭 EventSource 产生的 1 个精确 `net::ERR_ABORTED` 独立记录为 `expectedStreamAborts`，不伪装成“没有发生”。

输出位于忽略目录：

- `output/playwright/workbench-smoke.png`
- `output/playwright/workbench-smoke.json`

## 迭代与人工干预

首次实现后进行了六次有记录的功能修正：移除错误的本地 HTTP“远程 origin”配置；按真实互斥标签页分别检查规格、资产和 Relay 状态；设置安全的受控 fallback preview；识别终态 EventSource 主动取消；移除会在 opaque sandbox iframe 中制造 `navigator.serviceWorker` 假阳性的 Playwright block 注入；补齐七阶段 fixture 与预览对比度。独立审查后又消除了端口 TOCTOU，增加进程内并发拒绝、具体路径网络白名单、输出文件/目录防符号链接和 0600/0700 权限、静态文件 `lstat + realpath + 已打开句柄` 边界核验、真实诊断计数、Chrome 启动超时、显式 BrowserContext 清理，以及代理下游关闭时销毁上游 SSE；最后一项曾导致一次 120 秒悬挂，修复后直接 smoke 约 3.4 秒退出。没有降低业务断言或关闭应用错误诊断。

本实验的浏览器工具调用为一个 page、一次 Task 表单提交、一次 Task 查询/认领、一次事件批量发布、一次 Run 完成和一次全页截图。它证明 Workbench/Relay/UI 链路，不证明 CodeArts 自主编排，也不证明百炼、Seedream、火山 TTS 或 Freesound 真实账号调用。

## 验证命令

```text
bun run workbench:smoke
```

## 整仓门禁

- `bun install --frozen-lockfile`：通过，锁文件一致；
- `bun run check`：通过；
- `bun run test`：通过，286 项测试；
- `bun run build`：通过；Phaser 异步 chunk 保留既有 `>500 kB` 非失败警告；
- `bun run bundle:check`：通过；
- `bun run workbench:smoke`：通过，last sequence 14，11 项页面断言，三类意外诊断为 0，1 个预期 SSE abort 单独计数；
- `bun run doctor`、`bun run doctor:browser`、`bun run doctor:desktop`：通过；
- `bun audit --prod --registry https://registry.npmjs.org`：通过，0 个已知漏洞；
- `git diff --check`：通过。
