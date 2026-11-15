# 文档地图

先读哪份由问题决定，没有阅读前置顺序。三份纲领文档各自负责一类问题，专题文档是细节真源；纲领文档只写判断和入口，细节留在专题里，避免同一结论两处维护。

## 三份纲领文档

| 文档 | 回答什么 | 什么时候看 |
| --- | --- | --- |
| [产品文档](product.md) | 为什么做、服务谁、什么算做对、能力边界、常见误解、产品历史 | 判断某个需求是否属于产品意图，或要向他人解释定位 |
| [开发文档](development.md) | 代码怎么分层、逻辑从哪进、加功能改哪里、规范与门禁、选型理由 | 改代码、找落点、解释架构 |
| [运维文档](operations.md) | 依赖哪些外部资源、怎么发布回滚、看什么指标、按现象怎么查 | 发布、核验、回滚、排查生产问题 |

## 专题文档

| 文档 | 用途 |
| --- | --- |
| [订阅运行时](agent-guides/subscription-runtime.md) | 进程内订阅 Provider 的账号、调度、协议桥与排查方法 |
| [隐私脱敏](privacy-redaction.md) | 请求发出前的占位符替换与响应还原、生效范围、已知边界 |
| [日志能力标记](logs-applied-features.md) | Logs 列表 Feature 列的 id 契约、记录点、fallback 派生与前端呈现 |
| [观测性](observability.md) | 指标目录、请求阶段划分、日志分级、排查顺序；`/metrics` 三端点的语义 |
| [启动链路](startup.md) | 启动关键路径与预热划分、一次冷启动的时间线；其中 CLIProxy 子进程段落已过期 |
| [Model Group Alias](model-group-alias.md) | 每日时段路由的配置格式、时间边界与校验规则 |
| [Provider 账户额度](provider-account-quota.md) | DeepSeek / MiniMax 账户额度卡片的数据来源与 Key 类型识别 |
| [上游对齐记录](upstream-alignment.md) | 与 BerriAI/litellm 的 BUG 与能力对齐状态、发布记录、维护规则；对齐状态以这里为准 |
| [上游功能索引](upstream-features.md) | 逐条 PR 的功能清单与采用建议；已退役的核对入口指向清理记录或接替它的专题 |
| [无用功能清理记录](cleanup-candidates.md) | 2026-11-08 删除页面、桩接口与表的判定依据与保留清单 |
| [前端 Vue 重写记录](frontend-vue-migration.md) | 迁移范围、截图证据、发布门禁与手机端排版专项 |
| [Vite 8 测试链评估](vite8-test-chain-evaluation.md) | 2026-11-04 的测试链版本评估结论；Next.js 时期的历史记录，当前版本已不同 |

## 其他事实源

- `AGENTS.md`：协作方式、授权边界、完成定义与文档入口。不复制三份文档正文。
- `ui/litellm-dashboard/AGENTS.md`：前端范围的工作方法与契约。
- `.agents/skills/deploy-litellm-ts/`：生产拓扑、发布与诊断的真源（含 `references/troubleshooting.md`）。
- `.agents/skills/commit-staged-changes/`：提交改动的两种模式（普通提交 / 仅提交暂存），用户要求提交时使用；不含 push 或部署授权。
- `.artifacts/frontend-vue/`：前端迁移与手机端排版的原始截图、差异与验收记录，不进入镜像。
