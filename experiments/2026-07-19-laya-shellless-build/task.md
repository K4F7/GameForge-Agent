# 实验任务

收紧 LayaAir 3.4.0 本地构建边界：允许用户继续配置官方 dispatcher、`layaair.cmd`、`layaair` 或版本目录内 `Resources/cli-main.js`，但不得通过 shell 执行 wrapper，也不得依赖用户 `PATH`、`SystemRoot` 或外部 `taskkill`。

验收条件：

- 固定验证官方安装的 `versions.json`、`Resources/package.json` 和 `Resources/cli-main.js`；
- 只用当前 Node 直接执行固定主入口；
- 抖音 `bytedancegame` 真实本地构建与离线 validator 继续通过；
- 不登录，不调用模型或媒体 Provider，不执行 preview、上传、提审或发布；
- 记录 shell/环境/超时边界和剩余风险。
