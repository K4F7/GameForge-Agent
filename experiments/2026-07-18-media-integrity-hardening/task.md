# 实验任务

日期：2026-07-18

## 输入任务

加固 CodeArts 媒体资产恢复与 Freesound preview 导入：阻止同尺寸文件篡改绕过 Manifest，并阻止无 `Content-Length` 的超大 chunked preview 在限额检查前一次性进入内存。

## 验收条件

1. `ProjectAssetStore.read()` 对每个已验证边界内的普通文件流式计算 SHA-256；
2. 实际哈希必须同时匹配 runtime entry 与 provenance；
3. 同字节数篡改必须被恢复读取拒绝；
4. Freesound preview 必须流式读取，超过 16 MiB 后取消 reader；
5. chunked 超限测试不得依赖 `Content-Length`；
6. Provider、Asset Store 与整仓门禁通过，不调用真实云 API。

## 模型与人工干预

- 实现模型：GPT-5 Codex；
- 云模型与媒体 Provider：未调用；
- 子代理：用于跨目录安全审计，修改和验证由主代理完成；
- 人工干预：无。
