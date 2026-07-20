# 本地工作流端到端验收任务

## 输入任务

> 制作一个收集五个能量核心并避开障碍的浏览器小游戏。

## 验收目标

在无云密钥、无 CodeArts IDE/CLI 的本地边界内，以真实 HTTP Run Relay、真实 MCP Client、磁盘生成器和受控 Vite 预览证明以下工程链路可连续工作：

1. Workbench 等价 HTTP 请求创建 Task 与 Run；
2. MCP 认领 Task 并回放权威游标；
3. 校验并发布 `spec.ready`；
4. `dry-run` 后 `apply` 生成 Phaser 项目；
5. 通过生产 Asset Store 校验并落盘测试图片、Freesound 音效和 TTS 配音，分别发布连续的 `asset.ready`；
6. 启动受控预览并发布 `preview.ready`；
7. 完成 Run，回放结构化事件并同步 Task 终态。

本实验不模拟模型推理、媒体云调用、CodeArts 修复循环或浏览器玩法验收。图片、Freesound 和 TTS Provider 是确定性测试替身；异步 TTS 仍按 submit/query/materialize 三次调用执行，字节校验、许可与来源元数据、SHA-256、文件写入和 Manifest 更新使用生产实现。
