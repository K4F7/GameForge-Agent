# TUI 跨平台与交互终端验收

为 Bun TUI 增加可注入、可测试的终端呈现与控制层，并增加 Windows、macOS、Linux CI。验证非 TTY 输出无 ANSI，TTY 根据 rows/columns 截断，resize 触发重绘，q/Ctrl-C 中止 watch，退出时恢复 raw mode。
