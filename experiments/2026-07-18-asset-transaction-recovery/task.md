# 实验任务

日期：2026-07-18

为资产替换增加持久事务日志和显式 MCP 恢复，使进程在旧文件备份、新文件发布、Manifest 切换或备份清理之间终止后，可以只依赖磁盘权威状态安全回滚或完成提交，不调用媒体 Provider。

## 验收条件

1. 日志严格、脱敏、0600、无绝对路径且有大小上限；
2. 恢复只在资产写锁内执行，`get_project_assets` 保持只读；
3. Manifest 精确匹配旧 revision/hash/entry 时回滚；
4. Manifest 精确匹配新 revision/hash/entry 时完成清理；
5. same-path 与 MIME 变化的 cross-path 替换均可恢复；
6. 删除前验证路径、句柄身份、字节数和双 SHA-256；
7. 未知日志或第三种状态拒绝自动恢复；
8. MCP 暴露 `recover_project_assets`，不调用 Provider，默认权限为 ask。
