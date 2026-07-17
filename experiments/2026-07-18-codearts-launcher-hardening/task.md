# 实验任务

日期：2026-07-18

## 输入任务

加固本机 CodeArts OAuth TUI 的项目启动器：Windows 安装中 `bin/codearts.exe` 不存在时，自动回退到 CodeArts 安装生成的 `installers/codearts.cmd` shim；dry-run 必须显示实际选择且不启动客户端。

## 验收条件

1. `CODEARTS_BIN` 仍可显式覆盖；
2. Windows 默认先使用 exe，再回退 cmd；
3. cmd 通过 `ComSpec` 启动并保留客户端参数；
4. macOS/Linux 仍使用 PATH 中的 `codearts`；
5. 本机 `bun run codearts -- --dry-run` 发现真实安装且不打开 TUI；
6. 历史 client probe 不再与已通过的真实 E2E 结论冲突。

## 模型与人工干预

- 实现模型：GPT-5 Codex；
- 云模型/Provider：未调用；
- 人工干预：无。
