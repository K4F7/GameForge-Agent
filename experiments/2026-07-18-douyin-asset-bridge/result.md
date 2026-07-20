# 实验结果

状态：通过。

生产 `ProjectAssetStore` 根据受管项目 target 将逻辑 `assets/...` 路径映射到 Laya 源工程 `assets/resources/assets/`。写入 player PNG 与 bgm WAV 后，Manifest revision 为2；官方 LayaAir CLI 3.4.0 编译成功，发布目录包含：

- `resources/assets/manifest.json`；
- `resources/assets/images/player.png`，2,508 bytes，SHA-256 `89069aea989299269ba03498a173052f06148d4feb2ba79ed22292ceedcaa2ab`；
- `resources/assets/music/silence.wav`，1,644 bytes，SHA-256 `c726d333dd159a31423f3480dbb1c5c4a9dfcd30efe1f7e12ade390dc92e8908`。

发布校验结果：

```json
{
  "fileCount": 16,
  "totalBytes": 1108438,
  "mainPackageBytes": 1108438,
  "deviceOrientation": "portrait",
  "assetManifestRevision": 2,
  "assetCount": 2
}
```

发布文件的两个 SHA-256 与源 Manifest 完全一致；编译后的 `js/bundle.js` 包含 `resources/assets/manifest.json` 加载、`resources/` 路径映射和 `SoundManager.playMusic`。图片显示仍固定为 player/hazard 32×32、collectible 24×24、background 960×540；Manifest/单项加载失败保持程序化素材或静音。

实验中首次暴露 Laya CLI 内部编译失败仍返回进程码0的行为；builder 现持续扫描完整 stdout/stderr 的 `Build end, result=Failed`，即使保存日志超过64 KiB截断也会失败，并有回归测试。Builder 同时把发布媒体 Manifest projectId 与请求项目绑定。修正后再次执行真实官方构建，结果保持16个文件、2项媒体和相同哈希。该实验验证源工程到发布目录的媒体桥接与编译，不证明真实 Seedream/TTS 账号调用、DevTool 解码或真机听感。
