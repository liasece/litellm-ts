---
name: commit-staged-changes
description: 提交当前 LiteLLM TS 仓库已暂存的 Git 更改。仅当用户明确要求提交、commit、提交暂存内容、提交 staged changes，或指定使用 commit-staged-changes 时使用；只提交 index 中已有内容，不修改代码、不新增暂存、不回滚文件、不推送、不部署；如果 staged 内容包含多个修改部分，在提交信息正文中逐条列出。
---

# 提交暂存的更改

## 约束

- 只提交已经 staged 的内容。
- 不修改代码，不格式化，不回滚，不额外运行 `git add`。
- 不自动 push，不执行生产部署；只有用户另行明确要求时才执行。
- 不为提交而运行会读取整个工作树的测试或构建，因为结果可能混入 unstaged 内容；用户明确要求验证时除外。
- 如果没有 staged changes，停止并报告。
- 即使 staged 内容包含多个修改部分或看起来混合，也可以提交；不要因混合内容停止。
- 如果 staged 内容混合，必须在提交信息正文中准确表达每个主要修改部分。
- 保留所有 unstaged 和 untracked 内容，不查看其 diff 或文件内容，也不暂存或清理。
- 遵守当前对话和 `AGENTS.md` 关于 `git commit` 的授权要求；没有明确提交授权时不得提交。

## 提交信息

- 使用中文。
- 格式：`<type>: <简要描述>`。
- `type` 只能用 `feat`、`fix`、`refactor`、`docs`、`chore`。
- 根据 staged diff 的主要意图选择一个最准确的 `type`，不要只根据文件数量判断。
- 正文可选；需要时用多条 `-` 说明关键变更。
- 如果 staged 内容包含多个修改部分，正文必须用多条 `-` 分别列出，覆盖所有主要修改类别。
- 修复 issue 时，仅在能够确认 issue 编号时于末尾添加 `Closes #<number>`。
- 禁止添加 `Co-Authored-By` 等署名。

## 流程

1. 确认目标仓库路径：优先使用用户指定路径；否则使用当前工作区。
2. 运行 `git -C <repo> diff --cached --stat` 查看 staged 范围。
3. 必要时运行 `git -C <repo> diff --cached --name-only`，或针对性查看 `git -C <repo> diff --cached -- <path>`，用于理解 staged 内容；不要查看或改变 unstaged 内容。
4. 根据 staged diff、对话上下文和仓库近期提交风格编写提交信息。只有在确有必要时，才运行 `git -C <repo> log -5 --oneline` 辅助判断风格。
5. 运行 `git -C <repo> commit -m "<提交信息>"`；需要正文时追加独立的 `-m` 参数。
6. 运行 `git -C <repo> status --short`，确认提交结果，同时不得改变剩余工作树。
7. 成功后报告提交哈希、提交标题和仍然存在的 unstaged/untracked 状态；如果运行环境要求 Git directive，必须一并输出。

## 失败处理

- commit 失败时，报告失败原因和已执行到哪一步。
- 不自动修复代码、不自动 stage 文件、不绕过 hooks、不自动重试破坏性命令。
- hooks 修改文件或导致失败时，保留现场并报告，不把 hook 产生的内容加入暂存区。
