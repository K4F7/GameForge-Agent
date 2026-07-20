# Workbench 新任务结果

## 自动化覆盖

- Run ID 由毫秒时间的 base36 与清洗后的 12 位 UUID 熵组成，并再次经过 `runIdSchema`；
- 固定输入得到确定性结果，时间或熵变化会改变 ID，弱熵被拒绝；
- `ui.reset` 将终态 Run 完整恢复到初始 idle 状态；
- Workbench 目标结果：3 个测试文件、19 个测试通过。

## 真实 Chrome 流程

```text
打开 Workbench
→ 读取唯一初始 Run ID
→ 提交 Task
→ 显示 Task 回执且输入锁定
→ 停止 Run
→ 点击“新任务”
→ 新 Run ID 不同
→ 输入解锁
→ 旧 Task 回执清除
→ 右侧显示 NO RUN
```

最终一次输出摘要：

```json
{
  "firstId": "run-mrnlono8-bb600f4b9c0c",
  "secondId": "run-mrnloo03-7a4ab5a50cc2",
  "runBadge": "NO RUN",
  "oldReceiptCleared": true
}
```

截图：`.gameforge-validation/workbench-new-task/new-task-ready.png`

人工检查确认左侧显示第二个 Run ID，右侧为“等待运行 / NO RUN”，规格与阶段均为等待状态。

## 失败与修复记录

1. 第一版真实 UI 流程中，新 ID 和旧 Task 回执处理正确，但右侧仍显示上一条已停止 Run ID；原因是按钮只更新局部 React state，没有重置事件归约器。新增 `ui.reset` 后重新执行并通过。
2. 一次压缩内联脚本被命令策略在执行前拦截，没有启动服务或修改状态；改用展开脚本后通过。
3. 更早一次脚本中的中文正则被 PowerShell 管道转换成 `???`，在解析阶段失败；未启动产品服务，后续改用稳定结构选择器。

## 边界

- 新任务按钮不会自动提交，用户仍可先修改 Prompt；
- 运行中点击新任务只显示错误，不会停止当前 Run；
- Run ID 仍可在未连接时手工编辑，以便连接已有 Run。

## 最终门禁

- `bun run check`：通过
- `bun run test`：140 个测试通过
- `bun run build`：通过
- `bun install --frozen-lockfile`：无变更
- `bun run audit`：0 个生产依赖漏洞
- `git diff --check`：通过
