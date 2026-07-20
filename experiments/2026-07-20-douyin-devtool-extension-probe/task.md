# 输入任务

验证抖音开发者工具 4.5.4 是否能加载 GameForge 本地桥接扩展，并在不执行 preview、上传、真机调试、提审或发布的前提下，与本地确定性控制端完成握手，为后续官方 Douyin Runtime 自动测试建立入口。

验收条件：扩展可构建为 VSIX；官方内置 CLI 可安装并识别扩展；真实 DevTool Extension Host 激活扩展并发送 `hello/status`；所有远程操作保持禁止。
