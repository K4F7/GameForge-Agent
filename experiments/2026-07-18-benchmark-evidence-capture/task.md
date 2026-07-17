# Benchmark 证据捕获

新增一个只读命令，将严格 BenchmarkDefinition、人工核验元数据、Relay Task 与完整保留期 RunEvent 合成为现有 BenchmarkRecord。

验收条件：分页读取；验证连续 sequence、定义匹配和 Task/Run 终态；不猜测工具或人工字段；默认不导出 Prompt、日志、URL、素材提示或 job handle；真实 Relay 与整仓门禁通过。
