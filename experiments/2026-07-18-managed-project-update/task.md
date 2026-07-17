# 实验任务

日期：2026-07-18

让 CodeArts 根据新 GameSpec 更新已有生成项目，而不覆盖运行时资产、未知文件、Bun 锁文件或用户已经修改的受管代码。更新必须先 dry-run，再使用当前计划哈希执行 apply CAS，不提供 force。

## 验收条件

1. create 默认行为与旧客户端兼容；
2. update dry-run 不写文件，稳定列出 updated/unchanged/preserved/deleted/conflicts；
3. apply 必须携带 currentPlanSha256，锁内重新核验；
4. 用户修改的受管文件整批拒绝；
5. `public/assets/manifest.json`、`bun.lock` 和未知文件保留；
6. Manifest 最后切换，普通异常逆序回滚；
7. update lock 含 owner metadata，只保守恢复同机、过期且死亡 PID 的锁；
8. MCP 与 CodeArts Skill 保持 dry-run → ask → apply，事件仍由 CodeArts 连续发布。
9. update 在任何模板临时文件前写持久事务日志；显式恢复按旧/新 Manifest 提交点整批回滚或清理，不调用模型或 Provider。
