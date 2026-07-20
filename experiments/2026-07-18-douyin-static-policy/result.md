# 实验结果

状态：通过。

生成器在 Laya 源项目中写入严格 `assets/resources/gameforge-platform.json`，默认声明：

- `network/login/share/ads/payments=false`；
- `allowedNetworkHosts=[]`；
- `remoteScripts=false`。

官方 LayaAir CLI 3.4.0 成功构建，策略文件进入发布产物 `resources/gameforge-platform.json`。有界 builder 随后调用新静态门禁，真实结果为：

```json
{
  "fileCount": 13,
  "totalBytes": 1098029,
  "mainPackageBytes": 1098029,
  "deviceOrientation": "portrait",
  "capabilities": {
    "network": false,
    "login": false,
    "share": false,
    "ads": false,
    "payments": false
  },
  "allowedNetworkHosts": []
}
```

单元测试分别验证允许的离线产物，以及拒绝不支持文件类型、远程 JavaScript、HTTP、协议相对/本地地址、未声明域名、未声明网络能力、未声明登录 API、主包超过 4 MiB、整体超过 20 MiB、符号链接和危险分包根。静态门禁不能证明抖音后台域名白名单、TLS 1.2、DevTool 或真机运行。

独立安全复核后进一步收紧：不再豁免整个 `libs/` 目录；只有两个固定官方适配文件的 SHA-256 命中时才跳过 capability 归因，普通 `libs/evil.js` 仍会被扫描。补充拒绝方括号形式 `tt['login']` 和 `data:text/javascript`，文本读取增加 realpath、打开句柄身份与大小复核。最终再次对上述真实官方产物执行 CLI validator，结果保持通过。该扫描不声称能够证明任意动态 JavaScript 的完整数据流安全。
