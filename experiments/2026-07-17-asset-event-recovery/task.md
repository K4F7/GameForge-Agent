# 资产事件中断恢复任务

关闭媒体已安全落盘、但 CodeArts 在发布 `asset.ready` 前中断的窗口，避免恢复后重复调用 Seedream、Freesound 或 TTS 并撞上重复 asset ID/role。

验收条件：

1. 提供只读 `get_project_assets`，不调用 Provider、不修改文件；
2. 只接受生成器托管项目并严格验证 Manifest；
3. 每个引用文件必须存在、非符号链接、位于项目 `public/` 内且字节数一致；
4. capability 明确暴露 Asset Store ready，doctor 校验对应工具；
5. 完整工作流在落盘后、事件前从 Manifest 恢复 entry；
6. CodeArts Skill 按 asset ID 对账，只补事件、不重复媒体调用；
7. Bun 目标测试和整仓门禁通过。
