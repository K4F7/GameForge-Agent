# 任务

## 输入

在现有抖音 DevTool 本地桥接插件中复用成熟第三方方案的可用部分，增强连接、Runtime 探针和固定动作的鲁棒性，同时保持原有安全边界。

## 验收条件

- 不扩大 MCP 与扩展的动作白名单；
- 只连接 loopback CDP，并确定性选择 `MiniApp Webview`；
- 连接、命令、断连和清理具有确定性超时；
- Runtime context、输入、截图和 Console 返回值经过边界校验；
- TypeScript 严格检查、扩展测试、构建和真实 Runtime smoke 通过；
- 不执行 preview、上传、真机调试、提审或发布。
