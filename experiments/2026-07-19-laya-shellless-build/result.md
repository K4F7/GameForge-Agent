# 实验结果

## 实现边界

Builder 不再运行 `.cmd` 或其他 shell wrapper。配置入口属于官方安装布局时，它会：

1. 对入口、版本目录、元数据和主入口执行普通文件/目录、非符号链接与 realpath 核验；
2. 要求 dispatcher 的固定版本条目为 `3.4.0 -> 3.4.0`；
3. 要求 `Resources/package.json` 精确声明 `layaair-cli` 3.4.0；
4. 以当前 Node 直接执行 `Resources/cli-main.js`；
5. 子进程只收到固定 Node 目录 PATH、静态 Windows PATHEXT、临时目录和 `NO_COLOR`，不继承 CodeArts/Relay/Provider 凭据。

测试夹具把官方形状的 `layaair.cmd` 写成一旦执行就退出 99；构建仍然通过，证明 wrapper 没有被运行。另一个夹具把 `versions.json` 指向 `../outside`，Builder 在启动 CLI 前拒绝。非官方测试入口的 `--version` 输出现在也必须精确等于 `LayaAir CLI 3.4.0`，不能靠包含版本子串通过。

## 真实本地构建

使用已安装的官方 LayaAir CLI 3.4.0 wrapper 入口，对既有生成器托管的抖音小游戏执行生产 Builder。解析后的固定 `cli-main.js` 构建和离线 validator 均通过：

- target：`douyin-mini-game` / `bytedancegame`；
- CLI version：3.4.0；
- validator：passed；
- 本地构建产物文件：14；
- 总字节数：1,112,087；
- stdout/stderr：均未截断。

该证据只证明本地 Laya 编译与静态包校验，不证明抖音开发者工具、模拟器、真机或任何平台远程状态。

## 剩余边界

显式配置本机 CLI 仍表示信任该安装。GameForge 不承诺阻止同用户在元数据核验与 Node 启动之间替换文件；构建期间必须保护安装目录。超时会直接终止被启动的 Node 进程，但恶意 CLI 自行派生且拒绝退出的后代进程不属于本地构建器的沙箱保证。官方 CLI 与受管工程都应位于当前用户控制的目录。

## 最终门禁

- `bun run --filter @gameforge/minigame-validator test`：29 项通过；
- 真实 LayaAir 3.4.0 抖音构建：通过；
- `bun install --frozen-lockfile`：200 installs / 282 packages，无变更；
- `bun run check`：通过；
- `bun run test`：383 项通过；
- `bun run build`：通过；
- `bun run bundle:check`：game 与 Workbench 均无预算问题；
- `bun run audit`：无已知生产依赖漏洞；
- 隔离未配置环境的 `doctor:douyin`、MCP `doctor`、Chrome `doctor:browser` 与零权限桌面壳 `doctor:desktop`：全部通过。

首次尝试用 PowerShell 把可选变量设置为 null 时，子进程观察到空字符串，`doctor:douyin` 按设计以 `douyin_cli_path_empty` fail-closed；真正移除进程变量后返回健康的未配置状态。两次都没有执行平台 CLI 或远程操作。
