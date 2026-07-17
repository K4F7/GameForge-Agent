# 实验任务

日期：2026-07-18

让 CodeArts 在生成游戏后安全替换同一图片、音效或配音素材，而不删除项目、手改 Manifest 或重复创建角色。替换必须使用 Manifest revision CAS，在明显 stale 时避免调用云 Provider，并继续通过 `asset.ready` 驱动 Workbench。

## 验收条件

1. `create` 保持默认且不覆盖既有路径；
2. `replace` 必须指定已有 assetId 与 expectedRevision；
3. 旧文件哈希必须有效，角色唯一性保持；
4. 相同或不同扩展名的替换均更新 Manifest revision 并清除旧路径；
5. 普通文件系统失败可逆序恢复，额外回滚错误不掩盖；
6. 图片、Freesound 和 TTS MCP 输入支持替换，stale 预检不调用 Provider/下载；
7. 成功结果继续发布 `asset.ready`，刷新预览后加载新 Manifest。
