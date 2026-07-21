# GitHub PR 治理流程

Git commit、GitHub PR、required checks、review 和 GitHub 原生 auto-merge 是权威状态。正常流程无人值守；`pr-babysitter` 只用于冲突、持续失败或自动修复无法收敛时的按需恢复。

## 标准流程

1. `yeet` 建分支、stage、commit、执行本地检查、push，并创建或更新 Draft PR。
2. 创建 PR 的 Agent 补全标题和模板；确认工作区干净且本地 `check`、`test`、`build`、`bundle:check` 通过后执行 `gh pr ready`。用户明确要求暂缓时保持 Draft。
3. `CI` 对变更文件进行确定性分类：
   - 普通文档 PR 只修改 Markdown，且不包含 `AGENTS.md`、`.github/**`、`.codeartsdoer/skills/**`，跳过三平台 Bun job；
   - 其他 PR 在 Ubuntu、Windows、macOS 上执行完整 Bun 验证。
4. 始终存在的 `PR Gate` 汇总分类和 CI 结果。分支保护只要求稳定的 `PR Gate` context，不直接要求可能被跳过的 matrix context。
5. `GameForge PR Reviewer` 审查当前 Head SHA。只有 `PR Gate` 成功且没有阻断项时才提交 `APPROVE`。
6. Reviewer 提交 `REQUEST_CHANGES` 后，`GameForge PR Comment Fixer` 自动修复、验证并 push。最多自动修复两轮；之后仍有阻断项则停止并保留未解决线程。
7. 每次 push 都使旧批准失效，并重新执行 CI 和 Reviewer。
8. `GameForge Auto Merge Gate` 核对当前 SHA 的 `PR Gate`、Reviewer approval、零未解决线程、同仓库分支和受保护目标分支，然后通过 GraphQL 启用 GitHub 原生 squash auto-merge。
9. GitHub 仅在保护规则持续满足时完成 squash merge。Gate 不直接 merge，也不绕过保护规则。

PR 转为 Ready 即表示授权进入自动合并流程，不需要 `auto-merge` 或 `auto-fix-review` 标签，也不需要手工运行 `gh pr merge`。

## 职责边界

| 组件 | 职责 | 不做 |
|---|---|---|
| `yeet` | 创建或更新 Draft PR | 不审批、不合并 |
| 创建 PR 的 Agent | 完成本地门禁和 PR 描述后转 Ready | 用户要求暂缓时不转 Ready |
| `CI` / `PR Gate` | 文档分类、三平台验证和稳定 required context | 不做代码判断、不审批 |
| `GameForge PR Reviewer` | 审查当前 SHA，通过 safe output 提交 review | 不修改代码、不合并 |
| `GameForge PR Comment Fixer` | 自动处理可执行意见，最多两轮 | 不改 workflow、`.github/aw/**`、`AGENTS.md`，不审批、不合并 |
| `GameForge Auto Merge Gate` | 确定性核验并启用原生 auto-merge | 不直接 merge、不处理 fork PR |
| `pr-babysitter` | 按需处理冲突、持续 CI 失败和卡住的 review | 不属于正常流水线，不在会话结束后假装持续运行 |

源码冲突不由正常流水线自动解决。需要时调用 `pr-babysitter`；它只能自动处理锁文件、生成文件等确定性冲突，push 必须使用 `--force-with-lease`。逻辑冲突转交原实现 Agent 或人工处理。

## 合并规则

- PR 标题使用 `<type>(<scope>): <subject>`；自动化将 `feat`、`fix`、`docs` 等 type 映射为同名 PR label。
- 仓库只使用 squash merge；最终提交信息取 PR 标题。
- Draft、fork PR、失败或缺失的 `PR Gate`、非当前 SHA 的批准、未解决 review thread、冲突或无法验证的状态均阻止自动合并。
- Reviewer 若先于 CI 完成且因 `PR Gate` pending 未批准，CI 成功后 Auto Merge Gate 会重跑该 SHA 的 Reviewer，避免流程永久停住。

## Agentic Workflow 安全边界

Agentic Workflow 源文件为 `.github/workflows/*.md`，对应 `*.lock.yml` 必须由官方 `gh aw compile` 生成，不得手改。

- Agent job 使用只读权限和 `min-integrity: approved`；review、push、回复和 resolve 只能经 `gh-aw` safe outputs。
- Reviewer 最多写十条行内意见和一条汇总 review。
- Fixer 只处理同仓库、非 Draft PR 对当前 SHA 的 Reviewer `REQUEST_CHANGES` 或 OWNER/MEMBER 意见；GitHub App 私钥仅进入 safe-output job。
- Guardian 只创建去重诊断 issue，不修改代码、不审批、不合并。
- Auto Merge Gate 是无 Agent 的确定性工作流，只启用 GitHub 原生 auto-merge。

当前 Agentic Workflows 使用 Codex 和仓库已授权的 OpenAI-compatible Responses endpoint `https://api.sein.moe/v1/`：

| 工作流 | 模型 |
|---|---|
| `GameForge PR Reviewer` | `gpt-5.6-sol` |
| `GameForge PR Comment Fixer` | `gpt-5.6-terra` |
| `GameForge PR Guardian` | `gpt-5.6-terra` |

修改 Agentic Workflow frontmatter 后运行：

```powershell
gh aw compile --strict --validate --actionlint
```

## 仓库配置

工作流需要以下远程配置：

- `GAMEFORGE_GH_AW_ENABLED=true`；
- `GAMEFORGE_PR_AUTOMATION_ENABLED=true`；
- Secret `GAMEFORGE_CODEX_API_KEY`；
- Comment Fixer GitHub App 的 variable `GAMEFORGE_AUTOMATION_APP_CLIENT_ID` 和 secret `GAMEFORGE_AUTOMATION_APP_PRIVATE_KEY`；
- 仓库启用 auto-merge 和 squash merge；
- 目标分支受保护，要求 `PR Gate`、一个最新提交上的 approving review、最后 push 后重新批准及解决全部 review conversations。

凭据不得写入聊天、命令历史、仓库文件或实验记录。仓库权限和分支保护属于远程状态，修改前仍需明确授权。

首次启用时，先将 Auto Merge Gate 合并到默认分支，再用低风险 PR 验证 Draft→Ready、文档分类、三平台 CI、Reviewer、两轮 Fixer 上限和原生 auto-merge。`workflow_run` 只会使用默认分支上已存在的工作流，当前 PR 不能依靠尚未合并的 Gate 自举。

## 官方依据

- [GitHub Agentic Workflows Quick Start](https://github.github.com/gh-aw/setup/quick-start/)（访问日期：2026-07-19）
- [GitHub Agentic Workflows Safe Outputs](https://github.github.com/gh-aw/reference/safe-outputs-pull-requests/)（访问日期：2026-07-19）
- [GitHub Agentic Workflows Authentication](https://github.github.com/gh-aw/reference/auth/)（访问日期：2026-07-19）
- [GitHub：About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)（访问日期：2026-07-19）
- [GitHub：Managing auto-merge](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-pull-request-merges/managing-auto-merge-for-pull-requests-in-your-repository)（访问日期：2026-07-19）
- [GitHub：`GITHUB_TOKEN` event recursion](https://docs.github.com/en/actions/concepts/security/github_token)（访问日期：2026-07-19）
