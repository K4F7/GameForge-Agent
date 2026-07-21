# 实验环境

- 日期：2026-07-21
- 客户端：CodeArts Agent 26.6.2
- 模型：`huaweicloud-maas/deepseek-v3.2`
- Provider：MiniMax Music `music-3.0-free`
- 许可标记：`non-commercial`
- Relay：真实 loopback Relay，隔离持久化状态
- 项目输出：仓库忽略的 `.gameforge-validation` 隔离目录
- 认证：CodeArts 非交互 AK/SK 与 MiniMax API Key 仅从用户环境继承，未写入仓库或实验记录
- 平台远程操作：未执行 preview、真机、上传、提审或发布

实验开始时用户提供的是 `sk-cp` 前缀的订阅 Key。控制台核验后改用“请求管理 → API Keys”中的 `sk-api` 前缀普通 API Key；完整值未进入日志或仓库。
