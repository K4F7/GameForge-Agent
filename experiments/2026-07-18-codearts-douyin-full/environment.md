# 环境

- 日期：2026-07-18
- 系统：Windows，PowerShell
- Bun：1.3.14
- CodeArts：26.6.2，非交互 `run --format json`
- CodeArts 内置模型：`huaweicloud-maas/deepseek-v3.2`
- 认证：Windows 用户级 CodeArts CLI 凭据只注入子进程；实验未读取、打印或写入值
- MCP：本地 stdio，Node 启动已构建入口
- Relay：loopback HTTP，使用隔离的持久化状态
- 项目输出：被忽略的隔离受管输出根
- LayaAir CLI：3.4.0，动态启动器从环境注入已校验的绝对常规文件路径
- 媒体 Provider：0 次调用，五类 Provider 均未就绪

非交互客户端无法呈现 `ask` 确认，因此只在被忽略的单次实验配置中精确放行创建、认领、审计绑定、项目生成、玩法验收、抖音构建、事件发布和 Run 完成八个本地工具；可提交的生产模板仍保持修改类工具 `ask`。
