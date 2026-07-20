# Task 显式项目迭代

让 Workbench 与 Bun TUI 可在新 Run 中显式指定已有受管 `projectId`，并由 Relay/MCP 将该字段原样交给 CodeArts；CodeArts 只能按该字段选择 update/create，不从 Prompt、目录或旧事件猜测。

验收条件：字段经过严格 Schema、持久化和 claim；同 Run ID 更换项目时报幂等冲突；Workbench/TUI 均可提交；CodeArts Skill 明确 update dry-run/CAS apply；整仓门禁通过。
