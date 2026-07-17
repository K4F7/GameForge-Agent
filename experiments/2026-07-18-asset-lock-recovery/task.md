# 实验任务

日期：2026-07-18

## 输入任务

让 Asset Store 在 MCP 进程崩溃遗留 `.gameforge/assets.lock` 后能够保守恢复，同时绝不自动删除活跃、近期、异地主机或未知旧格式锁，也不增加 MCP 强制解锁能力。

## 验收条件

1. 锁仍使用跨平台原子 `open("wx")`；
2. owner metadata 包含 version、随机 token、PID、hostname、createdAt，且同步落盘；
3. 仅同机、PID 明确死亡、至少 10 分钟的合法锁可恢复；
4. 活 PID、近期、异地主机、空/损坏/旧格式锁保留并给稳定错误；
5. recovery guard 崩溃遗留也能按同样规则恢复；
6. 正常释放核对句柄身份与 token，不误删替换路径；
7. 不提供远程/强制 unlock，不声称支持网络文件系统或分布式锁。

## 模型与人工干预

- 实现模型：GPT-5 Codex；
- 子代理：审计锁协议、MCP边界与Node跨平台官方语义；
- 云 Provider：未调用；
- 人工干预：无。
