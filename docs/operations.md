# LiteLLM TS 运维文档

这份文档回答「系统跑在哪里、依赖谁、怎么发、出事按什么顺序看」。当你要发布、核验、回滚或排查生产问题时看它。它给的是**判断与入口**：拓扑值、命令和诊断阈值由 `$deploy-litellm-ts` 技能的 reference 与主机当前脚本维护，本文不复制一份可能漂移的副本。

## 定位与边界

覆盖：事实源与冲突裁决、外部依赖与服务商、持久化与文件位置、发布与回滚的判断、日志与监控入口、按现象组织的排查指引、运维事件历史。

不覆盖：产品意图（[产品文档](product.md)）、代码分层与门禁细节（[开发文档](development.md)）、`AGENTS.md` 里的授权与协作规则（引用，不复述）。

## 事实源与冲突裁决

按下面顺序裁决，前面能回答就不用后面：

1. 用户本轮的授权与范围限制。
2. 当前源码与 `package.json`。
3. 标准部署脚本与主机当前配置。
4. 容器、进程、日志与数据库活动。
5. `$deploy-litellm-ts` 的 reference 里的已知拓扑（只用于定位，不能替代现场确认）。

现场与文档不一致时，先用只读证据确定事实，再决定动作；无法唯一确认安全入口或工具链时停下报告，不要猜路径、版本或容器名，也不要在标准脚本之外自己拼一套部署。

## 运行环境入口

生产是单实例服务：一次性替换容器、允许短暂停机，不做蓝绿或多副本（这条取舍的来历见[产品文档](product.md#定位与边界)）。容器内 `node dist/main.js` 对外监听 `APP_PORT`（默认 4000），Dashboard 由同一进程从 `ui/out` 静态托管。

以下项目**值不写在这里**，每次现场确认，位置如下：

| 项目 | 去哪里确认 |
| --- | --- |
| SSH 主机入口、远程副本路径 | `$deploy-litellm-ts` reference 的「已知拓扑与事实源」，再用远端 `pwd`、`git status` 复核 |
| 验证容器与生产容器名 | 同上 reference，再用 `docker inspect` 核对挂载与状态 |
| 标准部署入口脚本 | 主机当前服务配置；reference 只给候选路径 |
| 外部入口域名与健康检查路径 | reference 的「标准部署与上线核验」一节 |
| Node.js 工具链 | `package.json#engines` + 主机实际 `node`/`npm` 版本；不在文档里固化绝对路径 |
| 生产配置与环境变量 | 部署脚本与容器运行参数（`config.yaml` 路径由 `CONFIG_PATH` 决定）；只读路径与用途，不打开 `.env`、不输出凭据 |

源码与构建副本的分工：本机 `~/src/jtllab/litellm-ts` 是唯一源码，JL3 上的副本只由 `~/bin/jl3-sync <本地仓库路径>` 单向进入（删除跟随本地；`.git`、`node_modules`、`dist`、`ui/out`、`*.tsbuildinfo` 与 `.jl3-sync-ignore` 列出的目录留在远端）。同步是发布的前置条件，但同步本身不等于部署授权。过渡期的 Samba 映射 `/Users/jansen/jl3/src` 只读保留，不再作为工作目录，也不要从它发起同步。

## 外部依赖与服务商

| 依赖 | 用途 | 失效时的影响与退路 |
| --- | --- | --- |
| PostgreSQL | 唯一持久化：配置、模型部署、凭据、SpendLogs 与块表、在途登记、预算与汇总 | 服务不可用；启动阶段会在有限预算内等待数据库就绪（认证失败、库不存在一类配置错误不重试，见[启动链路记录](startup.md)） |
| 直连上游 LLM 供应商 | DeepSeek、MiniMax、GLM、MiMo、LLMux、VLLM、OpenAI、Anthropic | 单个供应商故障应 fallback 或原样透传，不拖垮网关；入口清单以 `src/providers/ProviderRegistry.ts` 为准 |
| 订阅上游七家 | Codex、Claude、Kimi、Antigravity、xAI、CommandCode、OpenCode Go | 账号冷却、配额耗尽、refresh 失败都表现为该来源不可用；账号状态在 Subscriptions 页与 `/subscriptions/*` |
| 远端模型价格快照 | 从 `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json` 拉取，`src/cost/ModelCostMapService.ts` | 监听后异步预热、失败回退镜像内置的 `src/data/model_prices_and_context_window.json`，不影响启动。上游按 provider 收录、更新滞后，订阅渠道（opencode-go 等）新增模型常常没有条目，价格显示为空；这类缺口写进仓库补丁表 `src/data/model_cost_overrides.json`（维护方式见[持久化与文件位置](#持久化与文件位置)），不要临时改生产库里的 deployment 价格 |
| 上游服务状态页 | Logs 页顶部的 5xx 告警提示（用户 2026-08-04 要求） | 只是提示，不参与路由决策 |

新增外部依赖前先确认失败语义：它是否在启动关键路径上、失败是降级还是阻断、有没有本地兜底。

## 持久化与文件位置

- **数据库结构与迁移**：结构定义随代码走（`drizzle/`、`src/db/schema/`），实例、连接串与账号随环境走。迁移由容器启动时执行，`0000` 基线字节不可改，后续改动一律新增迁移。
- **SpendLog 存储**：`LiteLLM_SpendLogs` 存行，重复正文按内容寻址进 `LiteLLM_SpendLogBlocks`。块**只增不删**，删块会让仍引用它的日志失去内容；磁盘治理优先处理历史行与 TOAST，不要清块表。块表只保留 `block_id` / `payload` / `byte_size`；`first_seen` 没有读取方且无法作为清理依据，`0020` 已删除该列与索引。读侧块缓存默认 128 MiB，已知 id 上限 250k，分别用 `LITELLM_SPEND_LOG_BLOCK_CACHE_BYTES`（0 关闭载荷缓存）和 `LITELLM_SPEND_LOG_BLOCK_KNOWN_IDS`（0 关闭 known 集合）调整。缓存只影响命中率，不改变正确性；块 id 由内容决定，跨副本无需失效。当前进程常驻内存约 250 MiB，容器未设内存上限，扩容到 128 MiB 不需要同步改部署参数。
- **在途登记**：`LiteLLM_ActiveRequests` 只应保留真正在途的行；进程启动时会把旧进程遗留行标为 aborted。
- **旧日志回填**：新请求的[编码器](../src/spend/SpendLogBlocks.ts)会移除输入中已有的引用键。旧日志可能已有块引用，不能将数据库行直接当新请求重新编码。[仓库回填脚本](../scripts/backfill-spend-log-blocks.cjs)区分已编码行，并支持还原比对；它的跳过判断只查看消息列。先在隔离样本中覆盖纯内联、已引用、仅请求体带引用和混合数据；逐条对照还原后的消息与请求体，再重复回填，确认引用未变、没有缺块。没有可验证的恢复副本或出现不一致时，保留原行与块，停止扩大批次。
- **Usage 投影列**：`0019_spend_log_scalar_columns.sql` 为 `LiteLLM_SpendLogs` 增加 cache token、resolved model group 和 endpoint 四个小列，并在迁移内回填历史行，避免读侧切换窗口。可用 [回填脚本](../scripts/backfill-spend-log-scalar-columns.cjs) 的 `--count` 核对剩余量；只有迁移中断或外部写入造成不一致时才用 `--write` 补跑，脚本只更新四个标量列。列表与详情读路径已经直接使用这些列；不要再为 metadata 里的小字段新增重复列。
- **旧日志分页**：`GET /spend/logs` 默认返回轻量摘要，不再带 messages/response/proxy 正文；需要历史正文的脚本或排障调用要显式加 `include_content=true`，该模式单页最多 50 行。这是面向公共读契约的有意收紧，客户端升级前先用小 `page_size` 验证。`GET /spend/logs/ui/:request_id` 支持 `compact=true`，dashboard 固定使用它；手工调用不带时得到完整展开。内部 `POST /spend/logs/ui/batch` 只用于 dashboard 补齐缓存缺失的已结算详情，响应同样是 compact 形状；它不替代按权限实时读取当前详情。
- **TPS 口径**：Logs 列表的 TPS 列分别显示 Input（未缓存输入 token ÷ TTFT）和 Output（输出 token ÷（总耗时 − TTFT））。TTFT 缺失或等于/晚于结束时间时没有独立生成窗口，整格不显示；非流式请求的 TTFT 通常等于结束时间，这是正常现象。上游把整段回答缓冲到最后才写出时，首字与结束只差几毫秒，生成窗口不足总耗时 1%、或短于 300 毫秒的行也隐藏，否则几毫秒的分母会把交付毛刺放大成百万 TPS；两个门槛分别挡长请求与短请求里的短窗口。Speed 页只展示 Output TPS，使用同一分母与同样的 1%／300 毫秒门槛，因此这类调用会出现在「有调用但没有可测算输出速度」列表，而不是被算成异常快或异常的模型；曲线点与卡片平均值按 token 加权（Σ输出 token ÷ Σ生成秒数），改变权重口径后不要用「各请求 TPS 的算术平均」解释图表。排查「某模型有调用却没有速度」时先看 `completionStartTime` 是否严格早于 `endTime`，再看 `endTime - completionStartTime` 是否同时达到总耗时的 1% 与 300 毫秒。
- **请求头脱敏**：SpendLog 与在途行的 `proxy_server_request.headers` 在写入时把 Authorization、Proxy-Authorization、api-key、x-api-key、x-goog-api-key、x-litellm-api-key、cookie、set-cookie 的值替换成 `[REDACTED]`，读取侧对历史行再做一次兜底。排障只能看到头名，不能从 Logs 详情或导出里恢复凭据值。
- **历史敏感字段清理**：读侧脱敏只保证不展示，不会删除历史行 TOAST 里的原值。`0020` 部署完成、确认新容器已提供 `prepareSpendLogProxyForStorage` 后，先把 [清理脚本](../scripts/cleanup-spend-log-sensitive-data.cjs) 放进容器做只统计运行（不要加 `--write`），再按主键游标分批执行；脚本幂等，只改 `proxy_server_request`，不会动账务列、消息正文和块引用。2026-11-17 只读统计为 `LiteLLM_SpendLogs` 52,128 行、`LiteLLM_ActiveRequests` 0 行；执行后复查两项均为 0，原始 Authorization / x-api-key / `__litellm_responses_body` 均为 0。脚本需要 `pg`，在容器内运行时设置 `NODE_PATH=/app/node_modules`，或直接放在 `/app` 下。不要把 `--write` 与在线请求高峰叠在一起；每批默认 200 行、50 ms 间隔，超时和锁等待由脚本事务限制。
- **无读取入口对象**：`0020_cleanup_unused_objects.sql` 删除 8 个无查询视图、空测试 schema `litellm_credential_e2e`、空的 `drizzle` schema、仅被 `SpendTracker` 写 spend 的 `LiteLLM_AgentsTable`、Python 迁移历史 `public._prisma_migrations`，以及块表 `first_seen` 列。`public` 表从 34 张降到 32 张。迁移执行前已用生产 `public` schema 的临时克隆验证；这些对象没有当前读路径，但属于不可逆结构变更，不能按普通代码回滚处理。
- **订阅账号目录**：`CLIPROXY_RUNTIME_ROOT`（镜像默认 `/var/lib/litellm/cliproxy`）下的 auth 文件，删除的账号进 `.trash`；托管 CommandCode 账号与 OpenCode key 由配置投影成同目录文件。这里是运维边界：备份与迁移按目录处理，不要在数据库里另存一份 token。
- **凭据存放**：模型凭据走 `LiteLLM_CredentialsTable`（`CredentialSecretBox` 加密），`LITELLM_SALT_KEY` / master key 只在运行环境里。本文与任何日志、截图、补丁都不得出现它们的值。
- **前端产物**：`ui/out` 由构建阶段产出，运行时只读；缺失资源必须返回 404，SPA 回退只覆盖页面路由。
- **价格补丁表**：`src/data/model_cost_overrides.json` 与代码同发布、随远端快照一起生效（远端与内置镜像两条路径都会合并）。键按 `provider/model` 写，条目只需价格字段与 `source`；它只补上游没收录的模型，不会删条目。上游收录后仍以补丁为准，需要核对上游价目与原条目是否一致再删除补丁。改价依据优先取供应商官方价目页，不把价格写进 deployment 的临时配置。

## 部署与发布

授权边界不在这里定义：谁可以部署、什么算完成，见 `AGENTS.md` 的「授权与安全边界」「完成定义与部署闭环」，以及 `$deploy-litellm-ts` 的模式判定。运维侧只补充判断：

1. **前置**：改动已通过与其风险相称的门禁（[开发文档](development.md#验证与门禁)），工作区改动已用 `~/bin/jl3-sync` 同步到远端并核对 HEAD 与未提交项。同步输出是「远端确实是这次代码」的唯一凭据。
2. **执行**：只用现场确认过的标准入口，不手工拼 `docker run`，不在验证容器里跑宿主机部署脚本。
3. **观察阶段而不是看单条输出**：后端构建 → Dashboard production build → 镜像构建与校验 → 数据库只读预检 → 旧容器切换 → 新容器启动与迁移 → 健康检查。某阶段长时间无输出不等于失败；只要迁移事务仍活跃、容器仍在运行且未 OOM，就不要停止或重启。
4. **上线核验**：容器 running/healthy、无 OOM、无异常重启；有限范围启动日志显示服务与迁移就绪；外部健康入口与 Dashboard 入口可用；本次改动的真实可观察行为在生产上验证过。部署命令结束不等于发布成功。

失败时先定位到阶段再决定动作，不靠重复重启掩盖构建、依赖、网络或迁移问题。需要新权限、基础设施变更、生产数据写入或破坏性恢复时，保护当前可用状态并请求授权。

## 回滚

- **代码回滚**：保留上一已验证镜像，按 `$deploy-litellm-ts` 的恢复流程切回。不要为此改数据库结构。
- **数据库**：普通迁移以新增为主，但 `0020` 是本轮有意的结构清理，已删除无读入口的视图、表、列与旧迁移 schema；回滚到更早镜像前先确认旧代码是否还引用这些对象。`LiteLLM_AgentsTable` 的 spend 更新已从当前代码删除，旧镜像若恢复该路径，需要先恢复表或同步回滚本次清理。历史上 `0000` 基线字节被改动会触发 `MIGRATION_ARTIFACT_MISMATCH`，这是保护而不是故障。
- **块表与日志**：回滚代码不会让引用形态的行不可读（引用会退化成可见 JSON 结构），但真正的修复是恢复 `LiteLLM_SpendLogBlocks`。因此块表要纳入备份范围。
- **订阅运行时**：旧 auth 文件格式与目录保持可读，回滚旧镜像不依赖数据库结构变更；但旧镜像若仍期望 CLIProxy 子进程，则不能再按新架构回退（见[运维历史](#运维与事故历史)）。

## 日志与监控入口

| 想知道什么 | 看哪里 |
| --- | --- |
| 容器活着吗、有没有重启/OOM | `docker ps -a` / `docker inspect`（状态、OOMKilled、RestartCount） |
| 启动到哪一步、报了哪些错 | 容器日志（有限范围读取，不持续刷历史） |
| 健康与存活 | `/health/liveliness`（Docker healthcheck 用的就是它）、`/healthz` |
| 服务自身指标 | `/metrics`（Prometheus 文本）、`/metrics/summary?window=`（人读概览）、`/metrics/slow`（慢请求与失败明细）。三者都需密钥，语义见[观测性专题](observability.md) |
| 具体请求发生了什么 | Dashboard → Logs：列表、详情（含上下游差异）、session 时间线、Routing 轨迹 |
| 某模型快不快 | Dashboard → Speed |
| 脱敏有没有生效 | Dashboard → Privacy（统计与开关） |
| 订阅账号与额度 | Dashboard → Subscriptions、`/subscriptions/status`、`/subscriptions/accounts`、`/subscriptions/logs` |
| 数据库慢语句与锁等待 | 慢语句日志（>800ms 带 SQL 形态指纹）、`pg_stat_activity`（只读） |

观测数据默认开启采集（`LITELLM_OBSERVABILITY_ENABLED=false` 才关闭）。没有部署 Prometheus 服务端，`/metrics` 目前供人工与临时抓取使用。

## 按现象排查

| 现象 | 先看什么 | 常见原因 |
| --- | --- | --- |
| 页面打不开或静态资源 500/404 | 容器状态 → 静态资源路由 → `ui/out` 是否与镜像一致 | 前端产物缺失或版本不匹配；SPA 回退把不存在的资源吞成 HTML |
| 请求返回 503「活跃请求记录数据库暂不可用」 | 数据库连通与连接池 → 该时段慢语句 | 在途登记写库失败；数据库重启或锁等待 |
| 首字（TTFT）变慢 | `/metrics/summary` 的 `pre_upstream_ms`、`upstream_headers_ms`、`event_loop_delay_ms` | 本地数据库往返过多、上游慢、事件循环被同步工作占住；判定顺序见[观测性专题](observability.md#排查顺序) |
| Logs 列表很慢、数据库 CPU 上涨 | 列表查询计划与索引 → 分页参数 | 缺少覆盖索引、历史行过大、TOAST 膨胀；筛选列有专门的物化列与索引迁移 |
| 报「No available deployment for model」 | 该模型的 deployment 是否启用、健康检查、冷却状态 | 模型未配置、全部进入冷却、订阅来源缺账号或未就绪 |
| 订阅请求 401/403 反复 | 账号 `status`、`last_error`、`refresh_failures`、auth 文件时间戳 | refresh token 失效（终态错误会自动禁用）；不要把并发重复刷新当成解法 |
| 订阅请求 429「所有账号都在冷却中」 | 账号表 Rate limit 与上游 `Retry-After` | 配额打满或上游限流；需要加账号或等窗口 |
| 客户端报错但服务端看不到请求 | 客户端 UA/协议、`codingClientModelMiddleware` 的改写、Alias 解析 | 客户端用了别名或 Claude 形状 ID，日志按别名登记；只查实际模型名会漏 |
| 流式失败而非流式成功 | 终止事件、压缩错误、连接取消顺序；区分服务端生成完成 / SSE 传输完成 / 客户端读取完成 | 仅见 `AbortError` 无法判断哪一端先失败；需要客户端侧证据 |
| 容器 unhealthy、部署命令超时 | `docker inspect` 的 OOM、重启、健康状态；容器日志；`pg_stat_activity` | 迁移仍在跑（继续等）、健康检查窗口不足、数据库未就绪 |
| 启动即失败、日志出现 `57P03`/`ECONNREFUSED` | 数据库是否与本服务同时冷启动 | 启动预算内会自动重试；认证失败、库不存在属于配置错误，不重试 |
| 磁盘或数据库持续变大 | 表与索引体积、TOAST 占比、块表增长 | 历史行过多、重复正文、未回收的在途行；治理顺序是先块化后回收，不要直接删块 |
| 部署卡在构建阶段 | 构建进程 CPU、构建目录是否有文件写入、依赖下载阶段的网络活动 | npm 源或网络不可达导致卡在依赖安装；判定与「只停构建阶段」的安全条件见 reference |

## 运维与事故历史

| 日期 | 事件 | 结论与后续 | 细节来源 |
| --- | --- | --- | --- |
| 2026-07-27 | 确立单点部署与标准入口 | 一次性全量替换容器、接受停机；后续所有发布沿用 | 语料 2026-07-27T03:51、03:53 |
| 2026-07-27 | 生产诊断经验沉淀为 `$deploy-litellm-ts` | 拓扑与恢复方法只在该 Skill 维护，避免根指令与文档漂移 | 语料 2026-07-27T13:57、`.agents/skills/deploy-litellm-ts/` |
| 2026-10-12 | 上游对齐批发布，首轮核验暴露两项问题后补修复重发 | 上线核验必须覆盖真实 Provider 调用，不能只看脚本结束 | [上游对齐记录](upstream-alignment.md#生产发布与核验2026-10-12) |
| 2026-11-08 | Vue Dashboard 发布；清理迁移 `0011` 与发布同轮完成 | `0000` 基线字节未变，回滚代码不需要回滚结构 | [清理记录](cleanup-candidates.md) |
| 2026-11-09 | SpendLog 内容寻址块表上线 | 生产库 364 GB 中 99.4% 为重复 TOAST；块只增不删 | [上游对齐记录](upstream-alignment.md#2026-11-09-spendlog-内容寻址去重) |
| 2026-11-10 | 首次部署撞上主机 NVMe 故障（根分区被重挂只读） | 旧容器未切换、服务随主机恢复；次日重新部署成功并核对 `dmesg`/SMART | [上游对齐记录](upstream-alignment.md#2026-11-10-在途行正文内容寻址与记账事务锁顺序) |
| 2026-11-11 | `VACUUM FULL LiteLLM_ActiveRequests` 回收历史膨胀 | 209 MB → 3.3 MB，在途注册与删除无感知 | 同上 |
| 2026-11-13 | 手机端排版两次发布后，日志列表按用户要求回退为桌面表格 | 该页在手机上靠横向滚动；这是有意接受的代价 | [Vue 迁移记录](frontend-vue-migration.md#手机端排版专项2026-11-13) |
| 2026-11-14 | 历史回填误将已编码行当新请求，执行者估计约 11.6 万行丢失正文引用；随后用户选择清空请求日志及块 | 清理是事故后的单独决定。新日志恢复写入不证明旧内容迁移成功；后续回填按上文还原比对 | Harness `session-ee92cb22-e7c8-4c9c-a7d6-a6a70eca278d` 第 17 轮 |

同一类故障算一条记录，不按工单累加。新事故先补这一节的一句话与链接，详细过程写进对应专题或发布记录。

## 待确认

- 生产配置 `config.yaml` 的实际存放与版本管理方式（是否纳入主机侧 Git）没有在仓库内表达，需要运维确认后补入口。
- 备份策略：块表、auth 目录、数据库的备份频率与保留期未在语料或文档中出现，属于已知缺口。
- 是否接入真正的 Prometheus 抓取器：目前只有人工与临时抓取。
- `$deploy-litellm-ts` reference 里「Next.js 外部字体死锁」一节属于 React/Next 时期的前端构建；当前 Dashboard 用 Vite 构建，仓库内没有 `next/font/google` 引用。该分支是否还适用需要运维在下次维护 Skill 时确认。

## 这份文档不写什么

- 产品定位、用户诉求、能力边界 → [产品文档](product.md)。
- 代码分层、改动落点、门禁命令 → [开发文档](development.md)。
- 指标语义、阶段划分与排查顺序的推导 → [观测性专题](observability.md)。
- 部署与诊断的完整命令、拓扑值、阈值 → `$deploy-litellm-ts` 及其 reference，本文只引用入口。
