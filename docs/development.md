# LiteLLM TS 开发文档

这份文档回答「代码怎么组织、逻辑从哪进、加一个功能要改哪里、怎么验证」。当你要改代码、判断改动落点、或者解释某个分层为什么存在时看它。产品意图看[产品文档](product.md)，生产环境与发布排障看[运维文档](operations.md)。

## 定位与边界

覆盖：目录职责、请求链路、关键入口、扩展套路、编码与验证规范、技术选型理由、架构演进历史。

不覆盖：某个功能该不该做（产品），生产拓扑与发布授权（运维与 Skill），上游对齐的逐条状态（[上游对齐记录](upstream-alignment.md)）。

## 运行形态与技术选型

单进程 Node.js 服务，Express 4 承载全部 HTTP 与 WebSocket，PostgreSQL 是唯一持久化。确切版本以 `package.json`、锁文件和 `package.json#engines` 为准，本文不固化补丁版本。

- **TypeScript + strict**（`tsconfig.json`）：上游 Python 版的行为要靠类型和检查守住，`noUncheckedIndexedAccess` 与 `noImplicitOverride` 都开着。
- **Express 4**：中间件顺序即语义，且 SSE 逐帧写出、zstd 解压、逐字节透传都要直接操作原始 `req`/`res`；`res.write` 的语义最直接，换框架要重新验证整条链的时序。
- **pg + drizzle-orm**：迁移文件与 Python 版基线共存（`drizzle/0000_python_litellm_baseline.sql` 字节不可改），自有迁移从 `0001` 起，`src/core/db/python-schema-baseline.json` 记录与上游一致的表集合；被本仓库清理迁移明确移除的表（当前为 `LiteLLM_AgentsTable`）从基线同步删除。
- **Vue 3 + Vite 的 Dashboard**：2026-11-08 完成从 React/Next 的迁移，视觉与交互按旧版复刻。当前运行时不得引入 React、Next、TanStack Query 或第二套组件设计，理由与验收记录见 [Vue 重写记录](frontend-vue-migration.md)。
- **不引入第二套状态库**：前端用原生响应式 store，按功能分 `api / data / logic / stores / render / ui`。
- 被评估但未采用的选项：后端改 Go（2026-11-12 用户询问性能收益，语料中没有采纳决定，现状仍是 Node/TS）；把 post-upstream 放进 `worker_threads`（同日提问，未见落地记录，见[待确认](#已知缺口与待确认)）。重写之前请先确认没有更新的一致决定。

## 目录职责

| 路径                        | 职责                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.ts`               | 进程入口：加载配置、创建容器、装配中间件与路由、启动监听、优雅退出                                                                     |
| `src/container.ts`          | 服务容器：按依赖顺序建 Database / Credential / Router / 订阅运行时，并暴露幂等 `warmUp()`                                              |
| `src/core/config/`          | 进程级 YAML 加载与校验、DB 配置覆盖（`DbConfigProvider`）、每请求运行时快照（`DatabaseRuntimeConfigService`）                          |
| `src/core/db/`              | 连接池、启动重试、迁移与 `ProductionPreflight`（部署契约产物）                                                                         |
| `src/core/api/`             | 路由注册、错误映射（含流式错误码分类 `ClientErrorCode` 与 `Retry-After` 下发）、请求到达打点、响应头与脱敏辅助                         |
| `src/auth/`                 | 虚拟密钥、JWT、WebUI 会话、对象授权（`AuthorizationGuard`）、仓库层缓存                                                                |
| `src/router/`               | 路由决策：部署选择、重试策略、冷却、fallback（候选树展开见 [Fallback 与 Alias 候选树](fallback-routing.md)）、流式包装、标签路由、限流 |
| `src/providers/`            | 各上游 Provider 适配器与 `ProviderRegistry`（前缀解析、动态构造、订阅分发）                                                            |
| `src/subscriptions/native/` | 进程内订阅运行时：账号仓库、调度器、协议桥、七家 Provider 适配器、目录与额度                                                           |
| `src/proxy/`                | 对外 HTTP 端点：Chat / Messages / Responses / Embeddings / Images / Audio / Files / Search / 登录 / 发现                               |
| `src/management/`           | 管理面：Key、Team、User、Organization、Customer、Model                                                                                 |
| `src/spend/`                | 在途登记、结算队列、块存储、日志查询与会话时间线、WebSocket 推送                                                                       |
| `src/cost/`                 | 价格快照、费用计算、折扣与保证金、成本追踪                                                                                             |
| `src/capabilities/`         | 内置能力：视觉、Web Search & Fetch、图片生成及其审计                                                                                   |
| `src/privacy/`              | 请求脱敏与响应还原（占位符、SSE 重写、统计）                                                                                           |
| `src/observability/`        | 指标目录、HTTP/DB/进程采集、Prometheus 输出、慢请求日志                                                                                |
| `src/repositories/`         | 表访问边界：配置、模型部署、凭据、表级缓存的唯一入口                                                                                   |
| `src/ui/`                   | 后端静态托管 Dashboard 产物与 SPA 回退                                                                                                 |
| `src/shared/`               | 前后端共用：页面路径、模型族、Alias、速度计算                                                                                          |
| `ui/litellm-dashboard/`     | Vue Dashboard；`ui/litellm-dashboard-react-reference/` 是旧 React 实现的只读对照，被 gitignore 且只在 JL3 存在，不进镜像               |
| `drizzle/`                  | 迁移 SQL 与 `meta/_journal.json`                                                                                                       |
| `scripts/`                  | 迁移 journal 校验、SpendLog 回填等一次性脚本                                                                                           |
| `tests/`                    | 跨模块集成、Provider 与补丁回归；单元测试与被测文件同目录                                                                              |
| `.agents/skills/`           | 生产运维与提交两个专用工作流                                                                                                           |

## 请求链路

**启动**（`src/main.ts` → `src/container.ts`）：

1. 加载进程级 YAML（`CONFIG_PATH` 或工作目录 `config.yaml`），端口与连接串可被 `APP_PORT`、`DATABASE_URL`、`LITELLM_MASTER_KEY` 覆盖。YAML 只承载启动与连接基线；模型部署、模型组 Alias 与 fallback 只从数据库读取，YAML 中的对应键会被忽略并在启动日志中告警。
2. `createServiceContainer()` 只做关键路径：数据库接管与迁移 → DB 配置覆盖 → 凭据装载 → Router 构造 → 订阅运行时构造（执行处理器此时注册）。
3. `listen()` 之后才 `void container.warmUp()`：远端价格快照与订阅设置投影并行执行，失败只降级对应能力。启动链上的取舍与瓶颈证据见[启动链路记录](startup.md)（其中 CLIProxy 子进程部分已过期，见[已知缺口](#已知缺口与待确认)）。

**中间件顺序**（`src/main.ts#_assemblyExpress`，顺序即语义）：

`requestArrivalMiddleware`（记账口径的请求到达时刻）→ `httpMetricsMiddleware` → `zstdRequestDecompress` → `express.json({limit: 200mb})` → `markBodyParsed` → `accessLogFilter` → `upstreamExchangeScope`（上游交换旁路作用域，日志层据此读上下游详情）。

监听与观测端点、公开路由（登录、发现、`/` 跳转）之后注册 WebUI 静态资源，再注册鉴权 API 路由，最后是 `errorHandler`。

**推理链**（`_registerCoreProxyRoutes` 的 `proxyRouter`）：

`codingClientModelMiddleware` → `container.authMiddleware` → `webUiCsrfProtection` → `authorizationGuard.middleware("inference")` → `privacyMaskingMiddleware` → `runtimeConfigService.middleware(router)` → 请求级路由参数 → `sseKeepaliveMiddleware` → 具体端点。

脱敏挂在鉴权之后、端点之前，但真正的请求体改写发生在 Router 选完 deployment、即将发往上游的最后一层（`Router._executeRequest`），因为判定对象是最终去向（见[隐私脱敏](privacy-redaction.md)）。

**路由与记账**：`DatabaseRuntimeConfigService` 每请求建立一致快照 → `Router` 选 deployment、执行 retry / cooldown / fallback（`RouterExecution`、`FallbackHandler`、`CooldownManager`）→ `ProviderRequestExecutor` → Provider `build()` 出上游请求体 → 上游响应经协议 translator 回到入口协议。流式 fallback 的判据是「客户端是否已拿到答案内容」，实现见 `src/router/StreamOutputVisibility.ts`：包络块、思考增量与错误透传不算「已给出答案」，正文、拒绝文本与工具调用增量才算。

**记账与日志**：在途登记 `src/spend/ActiveRequestJournal.ts`，结算走 `SpendSettlementQueue`，最终落 `LiteLLM_SpendLogs`；重复正文按内容寻址进 `LiteLLM_SpendLogBlocks`（`src/spend/SpendLogBlocks.ts`），读侧在 DTO 层统一组装，业务代码不应直接碰 `_litellm_ref_*` 键。`LiteLLM_SpendLogs` 的 `cache_read_input_tokens`、`cache_creation_input_tokens`、`resolved_model_group`、`endpoint` 是供 Usage 本地时区聚合读取的小列投影，由 `drizzle/0019_spend_log_scalar_columns.sql` 建立并回填；正常写入、启动回收和租约过期回收都与日汇总同源填充这四列，完整 metadata/proxy 仍保留供 Logs 与会话详情使用。日志行的 `metadata.user_api_key_alias` 是虚拟密钥的真实别名；主密钥没有 token 行可查，读侧由 `src/spend/spendLogKeyIdentity.ts` 按 `api_key == hash(主密钥)` 补成 `Master Key`，属展示补充、不回写库。

**日志读路径**：`/spend/logs/ui` 列表只投影标量列，cache token 与 `key_alias` 直接读已有标量列（0016 的 `key_alias`、0019 的 cache token），`metadata` 会剥掉 `streaming_execution` / `responses_execution` 和已经投影的 `additional_usage_values` / `usage_object`，避免每行重复解压大 JSONB。详情接口默认返回服务端已组装的完整形状；dashboard 请求 `compact=true`，同一个对话在 `messages`、`proxy.body.messages`、`upstream.messages` 里只保留顶层一份，副本用 `_litellm_ref_messages` / `_litellm_ref_input` 的 `"$messages"` 标记表示，由前端展示层还原。这个标记是 dashboard 内部契约，外部调用方不要依赖；省略 `compact` 时仍得到完整展开。

Logs 列表的 TPS 列拆成 Input 与 Output 两个子项：Input = 未缓存输入 token ÷ TTFT，Output = 输出 token ÷（总耗时 − TTFT）。TTFT 缺失、早于请求开始或等于/晚于结束时间时，没有可分离的生成窗口，整格不显示；非流式请求的 TTFT 通常等于结束时间，属于这一类。上游缓冲整段回答再一次性写出时，首字与结束只差几毫秒，按生成窗口算出的 TPS 是交付毛刺，因此生成窗口不足总耗时 1%、或短于 300 毫秒的行也按「TTFT 已占满请求」隐藏——比例挡长请求里的几毫秒窗口，绝对下限挡短请求里的百毫秒级窗口（上游一次 flush 上千 token 的投递尖峰会在此被挡掉）。Speed 页使用与 Output 子项相同的生成窗口与两个门槛，不可测算行进入 `models_without_speed` 而不是画成被首字等待稀释或放大的曲线；桶内点与卡片平均值都按生成秒数加权（Σ输出 token ÷ Σ生成秒数），不是各请求 TPS 的算术平均。 列宽把 Time、Status、Session ID、Request ID 这类内容稳定的列固定住，其余列只声明最小宽度；容器变宽时只把余量分给 Model、Tokens、TPS 等弹性列，避免固定列跟着膨胀。只有可用宽度低于最小总宽时才横向滚动，不要把弹性列写死回固定像素。

前端把已结算详情当作不可变映射：`LogDetailsStore` 按 `request_id + start_date` 在内存中缓存，已结算负载不设 TTL，在途负载只保留一个轮询周期的短缓存。Session 抽屉切换选中行时，只对当前行前后各两条窗口内缺失的详情做预取，合并为一次 `/spend/logs/ui/batch`（每批最多 100）；单条详情继续承担当前行、实时更新与未命中兜底。批量接口与单条详情共用 compact 组装，冷存储 payload 也会先经过块还原与脱敏，不能把两者混成两种响应形状。

旧 `/spend/logs` 分页默认只返回与 UI 列表同形的轻量行；需要历史正文时显式传 `include_content=true`，该路径单页最多 50 行，避免一次拉回几十 MB 的 messages/proxy/response。新增读侧优化优先复用已有标量列和块缓存，不要为每个 metadata 小字段再加列；块缓存的字节上限与已知 id 上限分别由 `LITELLM_SPEND_LOG_BLOCK_CACHE_BYTES`、`LITELLM_SPEND_LOG_BLOCK_KNOWN_IDS` 控制，默认 128 MiB / 250k。Spend/Logs 的非流式 JSON 响应走 `src/middleware/SpendResponseCompression.ts`，大响应使用 Brotli q1 + gzip level 1；提高 quality 对已去重正文的收益很小，不要用 CPU 换不明显的体积。

**Messages 的内置工具**：`src/proxy/AnthropicCapabilityStream.ts` 把多轮上游调用组织成一条公开的 Messages 流。
文本和思考可以直接下发；混合工具轮里的调用要等能力循环确定哪些交给客户端，避免客户端执行已由网关接管的工具。
若使用生成图片扩展，首帧前已就绪的图片在 `message_start.message.generated_images`；
已发出文字或思考后才生成的图片在 `message_delta.delta.generated_images`，同一批图片只交付一次。

## 关键逻辑入口

| 想改的东西             | 从这里进                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 新增上游供应商         | `src/types/provider.ts` 的 `LlmProviders`、`src/providers/ProviderRegistry.ts`（`DEFAULT_API_BASES`、`PREFIX_TO_PROVIDER`、`createProvider`）、新增 `src/providers/XxxProvider.ts`、`src/data/provider_create_fields.json`、前端 `features/providers/data/ProviderCatalogData.ts` |
| 订阅 Provider 行为     | `src/subscriptions/native/`（`bridge.ts` 协议、`scheduler.ts` 选号、`providers/` 上游特化、`quota/` 额度）、[订阅运行时专题](agent-guides/subscription-runtime.md)                                                                                                                |
| 上游模型元信息         | `src/subscriptions/native/upstream/`（适配器、TTL 服务、合并与上限校验）；界面提示见 `ui/litellm-dashboard/src/features/models/ui/UpstreamModelHint*`，详见[订阅运行时专题](agent-guides/subscription-runtime.md#上游模型元信息持久弱缓存)                                        |
| 新增对外端点           | `src/proxy/XxxEndpoint.ts`，在 `src/main.ts` 对应 `_register*Routes` 里注册；若是页面路径同时改 `src/shared/WebUiPaths.ts`                                                                                                                                                        |
| 路由策略 / 重试 / 冷却 | `src/router/RouterExecution.ts`、`RouterRetryPolicy.ts`、`RouterExecutionBackoff.ts`、`CooldownManager.ts`、`RoutingStrategies.ts`                                                                                                                                                |
| 费用与价格             | `src/cost/CostCalculator.ts`、`ModelCostMapService.ts`、`CostTrackingConfig.ts`；上游快照缺条目的模型补在 `src/data/model_cost_overrides.json`                                                                                                                                    |
| 日志字段与查询         | `src/spend/SpendMetadataFields.ts`、`SpendManagementEndpoint.ts`、`src/db/schema/spendLogs.ts` + 新迁移                                                                                                                                                                           |
| 实时推送               | `src/spend/logStreamWebSocket.ts`（日志列表）、`logUpdatesWebSocket.ts`、`sessionTimelineWebSocket.ts`；契约见 `AGENTS.md` 的实时通知一节                                                                                                                                         |
| 内置能力               | `src/capabilities/BuiltinCapabilityRunner.ts`、`BuiltinCapabilitiesConfig.ts`、各自的 `*Capability.ts`                                                                                                                                                                            |
| 脱敏                   | `src/privacy/PrivacyMiddleware.ts`、`PrivacyDispatch.ts`、`SseRewriter.ts`                                                                                                                                                                                                        |
| 观测指标               | `src/observability/MetricCatalog.ts`、`HttpMetrics.ts`、`DatabaseMetrics.ts`、`RuntimeMetrics.ts`；指标语义见[观测性专题](observability.md)                                                                                                                                       |
| 模型/别名改名与引用审计 | `src/management/ModelReferences.ts`（引用清单、改名级联）、`ModelManagementEndpoint.ts`（`/model/rename`、`/model/references/audit`、删除守卫）；规范见「规范与最佳实践」的改名级联条目                                                                                             |
| Dashboard 页面         | `ui/litellm-dashboard/src/features/<name>/{api,data,logic,stores,render,ui}` + `features/application/data/PageRegistry.ts`、`NavigationData.ts`                                                                                                                                   |

## 新增一个功能应改哪里

- **新供应商**：枚举 → Registry 三个映射 → Provider 实现（上游 URL、头、协议、错误分类）→ 创建字段与前端目录 → 至少一个真实请求形状的回归。普通 OpenAI 兼容供应商优先复用 `OpenAICompatProvider`，不要复制一份。
- **新推理端点**：端点文件 + `main.ts` 注册 + 鉴权/授权/脱敏位置说明 + 是否记账（`SpendLogs.call_type`）+ 前端路径（若可达）+ 契约测试。
- **新数据库表**：`drizzle/00NN_*.sql` + 在 `drizzle/meta/_journal.json` 注册 + `src/db/schema/` 定义与 `index.ts` 导出 + `python-schema-baseline.json` + 一个拥有该表的 repository。删除表则反向操作：新迁移用 `IF EXISTS` 删除，移除 schema/导出/基线引用并删除对应写路径。已注册的迁移文件不可改字节，否则触发 `MIGRATION_ARTIFACT_MISMATCH`。
- **新 Dashboard 页面**：功能目录按 `api/data/logic/stores/render/ui` 分层 → 注册到 `PageRegistry` 与 `NavigationData` → 路径进 `src/shared/WebUiPaths.ts` → 手机端 320/390 不产生页面级横向滚动。同一业务的多个分区页面共用一个组件文件：`PageRegistry` 按文件路径缓存异步组件，页面 id 只决定 `currentPageKey`（`features/application/logic/PageContext.ts`）解析出的分区，这样切分区不会重建实例，已加载的数据与筛选条件都留着。没有后端支撑的页面不要建，参考[清理记录](cleanup-candidates.md)的判定原则。
- **新日志字段或筛选**：先确认是否要进表（加列 + 索引 + 回填脚本），再改 DTO 与 UI；筛选列有专门的物化列与覆盖索引迁移（`0016`～`0018`），不要用函数包住列导致索引失效。

## 规范与最佳实践

- **表边界**：`LiteLLM_Config`、`LiteLLM_ProxyModelTable`、`LiteLLM_CredentialsTable` 只允许 `src/repositories/` 下拥有它的 repository 与 schema 定义出现表名，由 `src/repositories/TableBoundary.test.ts` 扫描源码强制。新增热表时照此扩展边界，而不是让业务代码直接查。
- **运行时配置不缓存长 TTL**：配置改动必须下一个请求就生效，缓存只能放在 repository 层并自行失效。这是产品级约束，理由见[产品文档](product.md#设计理念与取舍)，不是可以拿来换性能的取舍点。
- **错误分类**：自身逻辑错误才记 `error` + 堆栈；上游 4xx/5xx 属于业务分支，按「能 fallback 就 fallback，否则原样透传」处理，不能算成服务端错误率或触发无意义冷却。这条来自用户对日志语义的要求，见[产品文档](product.md#设计理念与取舍)。
- **订阅模型命名**：`custom_llm_provider` 用订阅 slug，`model` 是原始上游模型 ID，新数据不要带 `cliproxy/`、`codex-subscription/` 一类运输前缀；历史日志的旧名只做只读兼容。
- **模型/别名改名必须级联修复引用方**：一个名字被 fallback 链（键与目标）、alias 目标、`model_info.override_model_name` / `fallbacks`、团队与虚拟密钥的 models 白名单、内置能力执行模型、`websearch_override_target_model` 共同引用。改名只改一处，其余引用会悬空并在下次路由时静默失效（生产上旧名请求先是弹到别的模型、后来变成 400，见 [上游对齐记录](upstream-alignment.md#2026-11-19-v1messages-订阅桥错误身份与-fallback-配置漂移)）。正确做法：经 `/model/update` 改 `model_name` 会自动级联；行已被别处改名时用 `POST /model/rename` 补齐引用；改完跑 `GET /model/references/audit` 确认悬空为零。删除最后一行部署前 `/model/delete` 会按同一清单拒绝；`/config/update` 拦截新引入的悬空引用。清单与改写实现集中在 `src/management/ModelReferences.ts`，新增引用面时必须登记进去，否则审计与级联都会漏。`LiteLLM_ProxyModelTable.model_info.fallbacks` 是历史死存储（展示与路由都读 `router_settings.fallbacks`），改名时会顺带重写但不要当作配置入口。
- **迁移纪律**：`0000` 基线不变，清理类改动用一个新迁移完成；删除无读取入口的表/列/视图时，在同一迁移里用 `IF EXISTS`，并同步移除代码与 Python 基线，不能留下写一个无人读取的表的路径。`make check-drizzle-journal` 会拦未注册的迁移文件。
- **前端**：组件只装配，派生值用 computed 或纯函数；与网络、计时器、订阅、图表实例相关的生命周期要显式销毁；不得用 `as any`、`@ts-ignore`、放宽 tsconfig 或关闭 ESLint 规则掩盖问题。具体契约见 `ui/litellm-dashboard/AGENTS.md`。
- **测试质量**：只测可观察行为、业务契约、重要分支和明确回归风险；不写复述静态配置或实现细节的断言。判据与反例见 `AGENTS.md` 的测试质量一节，不要在这里另建一套标准。
- **注释**：解释前因后果与约束，不复述代码在做什么。历史原因不确定时写「待确认」，不要编。

## 验证与门禁

命令以当前 `package.json` 与子目录 `package.json` 为准，本文只给选择方法。

后端：`npm run typecheck`、`npm run test:types`（测试文件的类型检查，Jest 走 `isolatedModules` 不做类型检查）、`npm test`、`npm run lint`、`npm run build`（只在需要 `dist` 产物时跑，发布构建由 JL3 构建容器执行）。全量门禁是 `make ci`：lint、typecheck、test、`check-circular`（madge 循环导入）、`check-drizzle-journal`、`check-format`。

前端：在 `ui/litellm-dashboard` 下 `npm run typecheck`（vue-tsc）、`npm test`（Vitest）、`npm run lint`（`--max-warnings=0`）、`npm run format:check`、`npm run build`，浏览器语义改动再加 `npm run test:components`（Playwright）。CI 的 `frontend` 与 `components` 两个 job 覆盖同一组检查（`.github/workflows/ci.yml`）。

每个改动至少跑 `git diff --check`，加上能覆盖受影响行为的最小充分检查；高风险、跨模块或发布前的改动扩大到完整相关测试与 production build。已知基线失败必须与本次回归分开说明，不放宽门禁绕过。

## 常见改错方式

- 在业务代码里直接写三张热表的表名 → `TableBoundary.test.ts` 失败；正解是给 repository 加方法。
- 给运行时配置加进程内长缓存「提性能」 → 配置改动延迟生效，违背产品级正确性要求。
- 把上游超时、配额、鉴权失败记成服务端 `error` 或塞进 cooldown → 污染错误率与路由，正确做法是分类后决定 fallback 或透传。
- 新增迁移但不登记 `_journal.json` → CI 的 `check-drizzle-journal` 失败，生产预检也会拒绝。
- 为了让日志「短一点」重新加回字段截断 → 内容寻址块跨副本命不中，去重收益归零。
- 在 Dashboard 里前端聚合 session 或自己算费用 → 与后端口径分叉，用户已明确否定这种做法。
- 把 `_litellm_ref_*` 占位当业务字段读 → 读侧尚未组装；应先经 DTO 组装层。
- 新端点忘记挂 `authorizationGuard("inference")` 或脱敏中间件 → 越权或敏感值直发上游。
- 用 React/Next 组件、第二套状态库或第二套设计补齐页面 → 违反前端契约。

## 开发历史

| 日期              | 变化                                                                                                                                                                          | 为什么                                                                                                                                     | 来源                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-05-29        | TypeScript 重写，Express + pg + drizzle 分层成形                                                                                                                              | 需要能自己改协议与面板的实现                                                                                                               | git `d5c8dbe`                                                                                                          |
| 2026-06-06        | 引入 Web 管理面板                                                                                                                                                             | 账号与日志需要图形化                                                                                                                       | git `34bca29`                                                                                                          |
| 2026-07-23        | 运行时配置改为 DB-only，删除进程内配置缓存                                                                                                                                    | 配置改动要立刻生效                                                                                                                         | git `0795930`                                                                                                          |
| 2026-07-27        | 日志列表改为按开始时间混合在途与已结算两张表                                                                                                                                  | 用户要求进行中的请求也出现在列表里                                                                                                         | 语料 2026-07-27T07:06                                                                                                  |
| 2026-08-05～08-10 | 内置能力依次引入（视觉 → 搜索 → 生图），最初在请求链内代理执行                                                                                                                | 客户端无法自己装能力，只能由网关注入                                                                                                       | 语料 2026-08-05 `codex:019fd013`、08-06 `codex:019fd4d3`、08-10 `codex:019fea43`                                       |
| 2026-11-02        | 内置能力重构为旁路中间件，不再侵入主流式链路                                                                                                                                  | 旧实现多次影响流式与日志，用户要求「从架构层面彻底做成旁路系统」                                                                           | 语料 2026-11-02T08:53                                                                                                  |
| 2026-10-11～12    | 上游对齐批落地 9 组能力：模型发现、Chat 参数、Responses input_tokens、编程客户端、SSE 心跳、路由与限流、日志内容、Usage API、管理 API                                         | 与上游行为对齐并修掉确认过的 BUG                                                                                                           | [上游对齐记录](upstream-alignment.md#本批实施结果2026-10-11)                                                           |
| 2026-11-03        | 流式 fallback 判据改为「客户端是否已拿到答案内容」                                                                                                                            | 旧实现会在已输出部分内容后仍切模型，产生自相矛盾的响应                                                                                     | [上游对齐记录](upstream-alignment.md#2026-11-03-流式-fallback-判据修正)                                                |
| 2026-11-08        | Dashboard 从 React/Next 迁移到 Vue 3 + Vite，同日删除桩接口与无读写表                                                                                                         | 前端维护成本；迁移与清理一次完成，避免长期并存                                                                                             | [Vue 迁移记录](frontend-vue-migration.md)、[清理记录](cleanup-candidates.md)                                           |
| 2026-11-09        | SpendLog 改内容寻址块存储                                                                                                                                                     | 364 GB 中 99.4% 是重复对话快照                                                                                                             | [上游对齐记录](upstream-alignment.md)                                                                                  |
| 2026-11-09～10    | 订阅执行从 CLIProxy Go 子进程改为 `src/subscriptions/native/` 进程内实现                                                                                                      | 少一层子进程与配置投影，账号与调度只有一个状态                                                                                             | `AGENTS.md`、语料 2026-11-10T13:30                                                                                     |
| 2026-11-10～12    | 在途行正文改内容寻址、记账事务锁顺序调整、结算异步化与结算队列                                                                                                                | 每请求二十多条语句与行锁争用拖慢首字                                                                                                       | [上游对齐记录](upstream-alignment.md#2026-11-10-在途行正文内容寻址与记账事务锁顺序)                                    |
| 2026-11-13        | 前端手机端排版收敛，日志表回退为桌面表格 + 横向滚动                                                                                                                           | 手机可读但不牺牲该页信息密度                                                                                                               | [Vue 迁移记录](frontend-vue-migration.md)                                                                              |
| 2026-11-15        | 日志表启用 opt-in 虚拟滚动，适配 Dashboard 内层滚动容器                                                                                                                       | 1000 行全量挂载约 6.7 万 DOM；只保留视口附近行，保留 URL/筛选/深链接                                                                       | [性能调查与实施记录](investigations/logs-page-size-1000-performance.html)                                              |
| 2026-11-17        | 清理无读取入口的 8 个视图、2 个空 schema、`LiteLLM_AgentsTable`、`_prisma_migrations` 与块表 `first_seen`，并物理清理历史认证头/内部 body                                     | SpendLog 读路径已切换，历史敏感原值只剩存储成本；删除前逐项确认无读入口                                                                    | [清理记录](cleanup-candidates.md#2026-11-17-无读取入口对象与历史敏感字段清理)                                          |
| 2026-11-18        | 日志页去掉 Live Tail 横幅（`LogsLiveBannerComponent`），开关旁改用连接状态指示灯（在线/重连中）                                                                               | 横幅长期占一行说明文字，Stop 按钮与工具栏「Live Tail」开关重复，断线重连时还会闪一条黄色提示                                               | `ui/litellm-dashboard/src/features/logs/ui/LogsPageComponent.vue`                                                      |
| 2026-11-18        | 模型列表与别名列表按品牌家族分组，未识别品牌的组排第一，组内保持当前排序                                                                                                      | 同一家族的条目散落在列表各处，找模型和判断品牌归属都要逐行看                                                                               | `ui/litellm-dashboard/src/features/providers/logic/ModelFamilyGrouping.ts`、`ModelFamilyLabelComponent.vue`            |
| 2026-11-18        | 模型列表的 Credentials 列对订阅部署显示 Provider 品牌并链到对应订阅账号页                                                                                                     | 订阅部署没有可复用 credential，之前一律显示 “Manual”，容易让人以为要在这条部署上手填密钥                                                   | `ui/litellm-dashboard/src/features/models/ui/ModelCredentialCellComponent.vue`（逻辑 `logic/ModelCredentialLogic.ts`） |
| 2026-11-18        | 模型家族识别覆盖裸名、连写版本号、品牌旧系列与 Bedrock 前缀（`opus`/`haiku`/`sonnet`、`gpt5`、`gemini3`、`grok4`、`deepseekv3`、`abab6.5`、`混元`、`sora`、`google.gemma-3`） | 别名和部署名常用不带分隔符或使用厂商旧称的简写，之前被当成未知品牌，图标与日志里的 `model_family` 都对不上；按生产 74 个真实名字核对后补齐 | `src/shared/ModelFamily.ts`（含 `ModelFamily.test.ts`）                                                                |
| 2026-11-18        | 有序配置统一用拖拽把手改序（`UiSortableList` + `UiDragHandle`），收起各处自写的上下箭头                                                                                       | 顺序即执行顺序，逐条点箭头在多目标链路上不可用                                                                                             | `ui/litellm-dashboard/AGENTS.md`                                                                                       |
| 2026-11-19         | Usage 与 Model Management 的标签页拆成侧边栏分区与独立路径（`/ui/usage/cost`、`/ui/models/retries` 等），`Add Model` 改为 All Models 页右上角弹窗 | 标签切换要能保留用量视图与日期范围、链接要能指向具体一页；一个组件承载同组多个页面 id，切分区不重建实例、不重取数据 | `ui/litellm-dashboard/src/features/application/data/NavigationData.ts`、`logic/NavigationLogic.ts`、`src/shared/WebUiPaths.ts` |
| 2026-11-19         | Upstream Account Quota 从用量页底部的区段改为 USAGE 下的独立页面（`/ui/usage/quota`，仅管理员），空数据时页面保留页头与刷新按钮 | 额度与日期范围、用量视图无关，挂在用量页底部既会被日期筛选误导，也要滚过整页才看得到 | `ui/litellm-dashboard/src/features/usage/ui/UsageUpstreamQuotaComponent.vue`、`logic/UsageSections.ts` |
| 2026-11-19         | Upstream Account Quota 账号名后加紧迫程度点：窗口真正用完（取整 0%）才是红，未耗尽但不高于 33% 为黄，全部高于 33% 为绿；无窗口数值的行不画点；点用更亮的同色系加光晕与呼吸动画 | 表格逐行要扫三条窗口百分比才能看出哪个账号快用完，行级概览把判断提前到账号名旁边；低但没用完只是预警，不该和耗尽一样刺眼 | `ui/litellm-dashboard/src/features/usage/logic/UsageQuotaRowsLogic.ts`、`ui/UsageUpstreamQuotaComponent.vue`、`styles/UsageQuotaStyles.css` |
| 2026-11-19         | Upstream Account Quota 增加自动轮询（5 分钟，隐藏标签页暂停、回到页面立即补刷），刷新调度器从日志页提到 `features/platform/logic/RefreshSchedulerLogic.ts` 共用 | 页面长时间开着时额度会过期，而手动刷新全靠人记得点；订阅账号额度查询直连上游，不能照搬日志页的秒级频率 | `ui/litellm-dashboard/src/features/usage/stores/UpstreamQuotaStore.ts`、`features/platform/logic/RefreshSchedulerLogic.ts` |
| 2026-11-19         | 入口 CSS 链接带源码指纹（`?b=`）：入口 CSS 在内容不变时文件名跨构建不变，边缘缓存可能把部署窗口里的 404 钉在整套基础样式上；指纹让每次源码变化都换 URL | 曾在 Chromium 上整页无样式而 Firefox/WebKit 正常，同一 URL 在不同请求头下命中不同边缘对象；只改文件名哈希无法覆盖“内容没变但又必须换 URL”的情况 | `ui/litellm-dashboard/scripts/BuildRuntime.mjs` |
| 2026-11-19         | Upstream Account Quota 增加浏览器侧额度缓存：打开先渲染上次成功快照并在后台刷新，刷新成功即覆盖重写；账号列表/内置 key/单账号额度失败时保留旧数值并如实显示错误 | 9 个订阅账号逐个查额度，等待体现为整页空白；缓存被误当成请求结果会让旧数值看起来是刚取的，所以失败必须继续显示错误与真实取数时间 | `ui/litellm-dashboard/src/features/usage/data/UpstreamQuotaCacheData.ts`、`stores/UpstreamQuotaStore.ts` |
| 2026-11-19         | Upstream Account Quota 从卡片网格改成按上游供应商分组的横向列表，一行一个账号（Account / Type / Quota windows / Balances / Updated），内置 provider key 与订阅账号共用一个行模型；重置倒计时移到进度条右侧（同样两行、列宽固定），三窗口账号的行高比“名称/条/倒计时”三行排布低一档 | 账号数量增长后卡片网格每行只放 1～3 个账号、横向空间浪费；倒计时独占一行时行高被文字撑开，右侧留白反而更多 | `ui/litellm-dashboard/src/features/usage/ui/UsageUpstreamQuotaComponent.vue`、`styles/UsageQuotaStyles.css` |
| 2026-11-19         | 品牌识别改看模型名里的品牌词，不再按 `anthropic/` 路径前缀兜底成 Claude；`anthropic/vllm-qwen3.8-27b`、`strata-qwen3.8-flash-next` 这类部署归到 Qwen | 同一批 vLLM 部署走 Anthropic 兼容协议，路径前缀是协议标记而不是品牌证据，按命名空间兜底会把千问画成 Claude | `src/shared/ModelFamily.ts`（`ModelFamily.test.ts` 增加包装名用例） |
| 2026-11-19         | USAGE 分区提到 OBSERVABILITY 之前，Model Activity、Key Activity 去掉顶部 Overall Usage 板块与其汇总计算（`summaryTopEntities` 随排行图一起删除） | 汇总卡片与趋势图是 Cost 页的视角，放在按实体聚合的页面上与下方实体列表重复；分组顺序按用户的阅读优先级调整 | `ui/litellm-dashboard/src/features/application/data/NavigationData.ts`、`features/usage/ui/UsageActivityComponent.vue`、`logic/UsageOverviewLogic.ts` |
| 2026-11-19         | 下线 Health Status、MCP Server Activity、Cost Tracking、Logging & Alerts 四个页面，删除对应前端组件与 `features/cost-tracking`、`features/logging-settings`；后端管理端点（`/get/config/callbacks`、`/config/cost_discount_config`、`/config/cost_margin_config`、`/cost/estimate`）保留 | 用户要求缩减管理面；这四个页面的配置能力已有公开管理 API，重复的视角让导航变长；旧地址靠路径别名与 `retiredPageRedirects` 落到活着的页面 | `ui/litellm-dashboard/src/features/application/data/NavigationData.ts`、`src/shared/WebUiPaths.ts` |
| 2026-11-19         | 模型表列宽改成只设下限（`UiTableColumn.minWidth`）：表头始终单行、列比文字窄时省略，容器有余量就按各列下限等比放大填满，装不下就保留下限横向滚动；短表头「Access Group」+ 142px 下限替掉 156px 的「Model Access Group」，Costs 列改成图标 + 金额的一行 chip（↓ 输入 / ↑ 输出 / 数据库 缓存读取），和日志 token 列同一种读法 | 原来每列一个固定宽度，Fallback / Override / Credentials 常常只有 “-” 却各占 180px，真正信息多的 Costs 只有 120px 被挤到换行；按列声明下限后，空白列不再抢空间 | `ui/litellm-dashboard/src/features/platform/ui/UiTableWidthLogic.ts`、`UiTable.vue`、`features/models/ui/ModelListComponent.vue`、`ModelCostCellComponent.vue` |

## 已知缺口与待确认

- `docs/startup.md` 中「内置 CLIProxy 子进程的 install/project/spawn/健康检查」整段已过期：对应模块（`CliProxyRuntimeManager`、`CliProxyModelCatalog`、`CliProxyStartupGate`）已不存在。其中「哪些工作必须阻塞到监听之前」的划分仍然有效，已在本文件的请求链路一节保留。是否重写该专题待确认。
- `docs/vite8-test-chain-evaluation.md` 是 Next.js 时期针对 Vitest 测试链的版本评估，结论已被 Vue 迁移后的工具链取代；当前版本看该文顶部状态说明与 `ui/litellm-dashboard/package.json`。
- 前端 provider 目录含 Ollama / Ollama Chat，后端 `ProviderRegistry.createProvider` 没有对应分支，未知 provider 直接抛错。是要走 OpenAI 兼容路径接入，还是从目录移除，待产品确认。
- post-upstream 是否迁到 `worker_threads`：2026-11-12 提出，语料无采纳或实施记录。

## 这份文档不写什么

- 产品定位、用户诉求与能力取舍 → [产品文档](product.md)。
- 生产拓扑、外部服务、发布回滚与故障排查 → [运维文档](operations.md) 与 `$deploy-litellm-ts`。
- 授权与协作规则 → `AGENTS.md` 与[公司共同工作约定](/Users/jansen/src/liasece/OPC/organization/shared-guidance.md)，本文不复制。
- 指标语义与排查顺序 → [观测性专题](observability.md)。
