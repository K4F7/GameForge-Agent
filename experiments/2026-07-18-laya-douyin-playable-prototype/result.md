# 实验结果

状态：本地构建与静态校验通过，平台运行待验证。

官方 CLI 成功创建 LayaAir 3.4.0 2D 空项目。`build --list-platforms` 在该真实项目中列出 `bytedancegame`、`wxgame`、OPPO、vivo、支付宝、淘宝等目标。场景通过官方 `.meta` UUID 机制挂载 `Laya.Scene` runtime。

原型实现：

- 960×540 纯代码场景；
- 触摸目标点和方向键/WASD移动；
- 三个收集物；
- 45秒倒计时；
- `YOU WIN` / `TIME UP` 终态；
- 不使用DOM、远程资源、登录、广告或支付。

执行 `layaair build bytedancegame` 成功，产物包含 `game.js`、`game.json`、`project.config.json`、`microgame-adapter.js`、`libs/laya.adapter-bytedance.js` 和已编译玩法 bundle。GameForge 静态校验结果：

```json
{
  "passed": true,
  "fileCount": 33,
  "totalBytes": 2341386,
  "mainPackageBytes": 2341386,
  "subpackages": [],
  "deviceOrientation": "portrait"
}
```

边界：CLI dispatcher 的官方安装流程从 Layabox CDN 下载版本 ZIP，但没有公开校验和/签名证据；二进制不提交仓库。当前原型位于忽略目录，尚未导入抖音开发者工具，也没有模拟器或真机截图，因此不能声称平台运行或发布完成。
