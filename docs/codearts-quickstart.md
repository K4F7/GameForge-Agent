# CodeArts Agent 快速开始

更新日期：2026-07-13

## 1. 选择使用形态

- 初次学习和观察Agent行为：优先使用CodeArts Agent IDE。
- 日常终端交互：使用TUI。
- 批处理、脚本和后续自动化评测：使用CLI。
- 观察多智能体任务拆解：使用Agent Space中的Agent Team。

## 2. 准备账号和客户端

1. 注册华为云账号。
2. 开通CodeArts Agent体验版、基础版或专业版。
3. 从CodeArts产品官网下载IDE或CLI。
4. 安装后按客户端引导完成浏览器授权。

Linux/macOS产品页当前提供的CLI安装方式为：

```bash
sh -c "$(curl -L https://cnnorth4-cloudide-marketplace.obs.cn-north-4.myhuaweicloud.com/codearts/cli_tui/install_script/install.sh)" \
  && export PATH=~/.codeartsdoer/installers:$PATH
```

执行远程安装脚本前，应先从官方产品页核对地址并检查脚本内容。

## 3. 打开项目

在CodeArts Agent IDE中可以：

- 导入本地文件夹；
- 新建项目；
- 克隆Git仓库。

本仓库推送到GitHub后，推荐直接使用“克隆Git仓库”，确保实验环境可重建。

## 4. 验证项目规则

CodeArts兼容项目根目录的`AGENTS.md`。打开项目后，在智能体模式输入：

```text
读取并概括当前项目规则。只汇报，不修改文件。
```

预期结果应包含：先检查上下文、实际运行验证、禁止虚构测试结果、记录实验数据等要求。

## 5. 使用项目级Skill

CodeArts项目级Skill位于：

```text
.codeartsdoer/skills/<skill-name>/SKILL.md
```

在对话中可以直接描述任务让智能体自动选择，也可以通过`/`菜单显式调用。

## 6. 使用MCP

在IDE的“设置 → MCP工具”中安装或配置MCP服务。首轮实验只启用必要工具，建议从一个浏览器自动化MCP开始。官方建议同时开启的MCP数量保持精简。

## 7. 第一次基准实验

输入：

```text
检查这个仓库的文档结构，找出链接、术语或结构上的问题；先列验收条件，再完成最小修改，最后给出实际验证结果。
```

记录：

- 使用的CodeArts版本和模型；
- 总耗时；
- 读取、编辑和终端工具调用次数；
- 人工确认次数；
- 是否一次通过验证；
- 最终提交差异。

## 官方文档

- [IDE快速启动](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0002.html)
- [CLI产品概述](https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0001.html)
- [CLI下载安装](https://codearts.huaweicloud.com/download.html)
- [Rules](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0019.html)
- [Skills](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0024.html)
- [MCP](https://support.huaweicloud.com/usermanual-codeartssnap/codeartsdoer_ug_0010.html)

