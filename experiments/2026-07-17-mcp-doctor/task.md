# MCP 配置体检任务

为 CodeArts 用户提供一个提交前、启动前都可执行的无密钥 doctor，在进入 IDE 前发现运行时、锁文件、构建入口、stdio 握手、必需工具和 Provider 配置问题。

验收条件：

1. 使用 Bun 构建，Node 承载生产 MCP；
2. 验证 Node/Bun 最低版本和 Bun 单锁；
3. 使用真实 MCP Client 完成 stdio 握手、列工具和调用 capability；
4. 不调用云端，不输出密钥；
5. 失败返回非零退出码与稳定问题码；
6. stderr 有界并按已配置凭据值脱敏；
7. 单元测试、真实 doctor 和整仓门禁通过。
