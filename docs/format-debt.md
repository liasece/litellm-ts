# TypeScript 格式债清单

`make ci` 与 `make ci-full` 都会执行 `npx prettier --check "src/**/*.ts"`，配置来自 `.prettierrc`
与 `.editorconfig`（tab 缩进、140 列）。清单已于 2026-11-22 清零，当前没有待清理文件。

## 现状

- 提交 `29ff9d0`（`style: 清理剩余 Prettier 格式债`）把最后 36 个已跟踪文件按仓库配置格式化；
  提交里只有空白与换行调整，不含逻辑、注释或导入顺序改动。
- 当时尚未跟踪的新文件随各自改动提交，写之前跑一次 `npx prettier --write` 即可。
- 工作区 `npx prettier --list-different "src/**/*.ts"` 为空，`make ci` 与 `make ci-full` 的格式项通过。

## 再出现格式债时

1. 先用 `npx prettier --list-different "src/**/*.ts"` 取清单，区分「已提交内容」与「并行开发中的修改」。
2. 只格式化已提交内容时，从 HEAD 取文件内容格式化后再提交，避免把别人工作区里的未提交改动带进提交。
3. 运行 `npx prettier --check "src/**/*.ts"` 与 `make ci` 验证清单归零。

不要通过 `.prettierignore` 排除 `src/` 源码，也不要在格式检查失败时跳过该门禁。
