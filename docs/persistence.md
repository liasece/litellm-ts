# 持久层：表只能由仓储访问

> 面向「我要改某张表的 SQL / 加一张表 / 调缓存」的场景。目录职责与门禁见[开发文档](development.md)，运维侧的环境变量见[运维文档](operations.md)。

规则不是「一张表只能有一个文件」，而是**一张表只能由 `src/repositories/` 下拥有它的仓储读写**。同一张表允许按访问形态拆成几个文件：写模型（CRUD + 缓存写穿）、读模型（看板/报表的重查询）、结算（跨表单语句）。这样改一次缓存策略只需要动写模型，而报表查询不会把业务写路径拖进复杂 SQL。

## 一句话结构

业务模块（端点、记账流程、订阅运行时、配置快照）不写 SQL，只调用 `xxxRepositoryFor(db)` 取到的仓储；仓储是某张（或某几张同生命周期表）的唯一访问点，读走进程内副本，写走「SQL → 写穿副本」。

```
HTTP 端点 / 记账流程 / 后台任务
        │  只调用方法，不出现表符号
        ▼
src/repositories/XxxRepository.ts        ← 一张表（或一对主从表）一个文件
        │  读：TableCache 整表副本 | EntryCache 按键缓存 | 不缓存
        │  写：SQL → upsert/remove/set/deleteByTag
        ▼
PostgreSQL
```

`src/repositories/TableBoundary.test.ts` 扫描源码强制两件事：

1. `src/db/schema/` 里的表符号（由 `pgTable(` 导出名自动收集）只允许出现在文件名以 `Repository.ts` 结尾的模块里；schema 目录与 `src/core/db/SchemaPreflight.ts` 例外。
2. 业务代码不得 `new XxxRepository(...)`，只能经工厂取用（`container.ts` 装配处与测试替身例外）。

## 依赖方向：schema 与 types 只能是叶子

仓储都 import schema，所以 schema 一旦回头 import 业务模块（capability、router、spend），
仓储就会被拉进业务依赖环，`make check-circular` 立刻变红。共享形状放叶子文件，两边都只依赖它：

| 叶子文件 | 承接什么 | 谁在用 |
| --- | --- | --- |
| `src/types/upstreamLog.ts` | `UpstreamLogContext` / `*RequestLog` / `*ResponseLog` / `UpstreamErrorRecord` | schema 列类型、在途补写、日志详情 |
| `src/types/spendInfo.ts` | `DeploymentSpendInfo` | 花费落库、上游诊断上下文 |
| `src/types/generatedImage.ts` | `BuiltinGeneratedImage` | `imageCompletions` 列类型、图像能力 |
| `src/types/spendEnums.ts` | `CallType` / `SpendLogStatus` | `spendLogs`、`activeRequests` 列类型 |

代价是这几处的类型不能再用 `export type { X } from "./old"` 转发（lint 禁止桶导出），
使用方要从叶子文件 import；换来的是 `check-circular` 保持 0 条。

## 表 → 仓储文件

| 表 | 仓储文件 |
| --- | --- |
| `LiteLLM_Config` | `ConfigRepository` |
| `LiteLLM_ProxyModelTable` | `ModelRepository` |
| `LiteLLM_CredentialsTable` | `CredentialRepository` |
| `LiteLLM_SearchToolsTable` | `SearchToolRepository` |
| `LiteLLM_UpstreamModelMeta` | `UpstreamModelMetaRepository` |
| `LiteLLM_SubscriptionAccount` | `SubscriptionAccountRepository`（写）、`WebUiSupportRepository`（读） |
| `LiteLLM_SubscriptionAccountState` | `SubscriptionAccountStateRepository` |
| `LiteLLM_VerificationToken` | `KeyRepository`（写）、`SpendSettlementRepository`／`SpendReservationRepository`（结算与预留的跨表语句）、`WebUiSupportRepository`（读） |
| `LiteLLM_DeprecatedVerificationToken` | `KeyRepository` |
| `LiteLLM_DeletedVerificationToken` | `KeyRepository`（写）、`WebUiSupportRepository`（读） |
| `LiteLLM_UserTable` / `LiteLLM_TeamTable` / `LiteLLM_TeamMembership` | `UserRepository` / `TeamRepository`（写）、`SpendSettlementRepository`／`SpendReservationRepository`、`WebUiSupportRepository`（读） |
| `LiteLLM_OrganizationTable` / `LiteLLM_OrganizationMembership` | `OrganizationRepository`、`SpendSettlementRepository`／`SpendReservationRepository` |
| `LiteLLM_BudgetTable` | `BudgetRepository`、`SpendReservationRepository`（预留校验） |
| `LiteLLM_EndUserTable` | `EndUserRepository`、`SpendSettlementRepository`／`SpendReservationRepository`、`WebUiSupportRepository`（读） |
| `LiteLLM_ProjectTable` | `ProjectRepository`、`SpendSettlementRepository`／`SpendReservationRepository` |
| `LiteLLM_ObjectPermissionTable` | `ObjectPermissionRepository` |
| `LiteLLM_UpstreamKeyAccount` | `UpstreamKeyAccountRepository`（写）、`WebUiSupportRepository`（读） |
| `LiteLLM_SpendLogs` | `SpendLogRepository`（写）、`SpendReportingRepository`／`SpendAggregationRepository`／`SessionTimelineRepository`／`WebUiSupportRepository`（读） |
| `LiteLLM_SpendLogBlocks` | `SpendLogBlockRepository`（写）、`SessionTimelineRepository`（读） |
| `LiteLLM_SpendReservations` | `SpendReservationRepository` |
| `LiteLLM_ActiveRequests` | `ActiveRequestRepository`（写）、`SpendReportingRepository`／`SpendAggregationRepository`／`SessionTimelineRepository`（读） |
| 六张 `LiteLLM_Daily*Spend` | `DailySpendRepository`（写）、`WebUiSupportRepository`（读） |
| `LiteLLM_ImageCompletion`／`LiteLLM_ImageCompletionAnchor` | `ImageCompletionRepository` |
| `LiteLLM_BuiltinCapabilityImages` | `BuiltinCapabilityImageRepository` |
| `LiteLLM_PrivacyRedaction*` | `PrivacyStatsRepository` |

拆分的判据：**谁写这张表，谁负责让缓存跟上**。读模型不缓存、不失效、不加锁，只描述查询；跨表原子语句（结算的 `WITH`、预留校验的锁序）留在结算仓储，不要为了「一表一文件」把它拆成多条语句。

## 为什么是仓储层而不是中间件层

- **单实例部署**是前提：配置与账号变更都经过本进程，所以本进程既是唯一写入方，也是缓存权威来源。若将来改成多实例，写穿只对写它的那个实例有效，TTL 与失效语义都要重新设计（见下文「改部署形态时」）。
- 缓存放在仓储层，鉴权链、管理端点、WebUI 会话校验、记账读取共享同一份副本；放在中间件层则每个入口都要自己实现一遍，且写路径无法让别的入口失效。
- 「写入后下一个请求生效」是产品级约束，由写穿保证，不依赖 TTL。TTL 只兜底「绕过本进程直接改库」这类旁路写入。

## 三类表与缓存策略

| 类别 | 表 | 缓存形态 | 默认窗口 | 调参 |
| --- | --- | --- | --- | --- |
| 小配置表 | `LiteLLM_Config`、`LiteLLM_ProxyModelTable`、`LiteLLM_CredentialsTable`、`LiteLLM_SearchToolsTable`、`LiteLLM_UpstreamModelMeta`、订阅账号 | 整表副本（`TableCache`），行数固定几十行 | 兜底整表重读 5 分钟 | `LITELLM_TABLE_CACHE_SAFETY_REFRESH_MS`（0 关闭） |
| 账号实体 | key（含弃用/删除记录）、用户、团队、团队成员、组织、组织成员、预算、终端用户、项目、对象权限、上游 key 归属 | 按键副本（`EntryCache`），行数随租户增长 | TTL 5 分钟，最后 75 秒命中触发后台补读 | `LITELLM_AUTH_REPOSITORY_CACHE_TTL_MS`、`LITELLM_AUTH_REPOSITORY_CACHE_REFRESH_AHEAD_MS`（0 关闭） |
| 流水与在途 | `LiteLLM_SpendLogs`、`LiteLLM_SpendLogBlocks`、`LiteLLM_SpendReservations`、`LiteLLM_ActiveRequests`、六张 `LiteLLM_Daily*Spend`、图片历史、隐私统计、脱敏值 | 不缓存 | — | — |

`LiteLLM_AUTH_REPOSITORY_CACHE_*` 这个前缀是历史名（最初只有鉴权实体用它）；现在它是所有按键副本共用的 TTL，语义见上表。

## 写穿与失效

| 写入 | 谁做 | 缓存动作 |
| --- | --- | --- |
| 配置/模型/凭据/搜索工具新增或修改 | 各仓储写方法 | `.returning()` 的行 `upsert` 进副本；只改不返回时 `invalidate()` 整表重读 |
| 删除配置项/工具/凭据引用 | 各仓储写方法 | `remove(...)` / `invalidate()` |
| key 新建、封禁、续期、删除 | `KeyRepository` | `set`（新行）或 `invalidateAuthCacheForTokenHash`，并清主体标签 |
| 用户/团队/组织/成员/预算/项目/终端用户改删 | 对应仓储 | 写穿返回行，或按主体标签失效（`invalidateAuthCacheForSubject`） |
| 记账结算（一次事务内） | `SpendSettlementRepository` | 事务内只失效不写穿（提交前写穿会暴露未提交值），提交后 `invalidateAuthCacheForSpendSubjects` 清 token/用户/团队/成员/组织/项目/终端用户 |
| 冻结/恢复预算 | `BudgetRepository` | 清对应预算键与主体标签 |

事务内「只失效不写穿」是刻意选择：提交前的写穿会把未提交值读给别的请求，回滚后还会留下脏读；失效在回滚时天然安全，下一次读回落到数据库。

## 一致性模型

- 应用内写入：下一个请求可见（写穿/失效）。这是必须成立的契约。
- 旁路写入（运维手工 SQL、另一套实例）：最多 5 分钟可见（整表副本的兜底重读间隔、按键副本的 TTL）。
- 负结果不缓存：遍历式无效 key 探测不会撑大缓存，刚创建的实体也不会在 TTL 内不可用。
- 冷启动装载失败 fail-closed：整表副本宁可让请求失败，也不返回空配置；后台兜底重读失败保留旧副本并告警。
- 提前刷新只影响延迟：命中但临期时先返回旧值，再单飞补读（并发上限 8，超限的那次留给 TTL 过期后的同步读）；补读期间条目被替换/失效则丢弃结果；补读查到 null 则删条目。

## 跨表语句与事务

结算里的 `WITH ... UPDATE` 跨七个主体表，仍然是一条语句、一次往返：它写在 `SpendSettlementRepository`，接收调用方传入的事务句柄，不自己开事务。拆成七条 UPDATE 会把「主体数 × 往返」重新叠加到结算延迟和行锁持有时间上——这是迁移时明确保留的边界，不要为了「一个仓储一张表」的整齐去拆它。

同理，任何跨仓储的写入都应由业务层开事务、把 `tx` 传给仓储方法；仓储方法不自行 `transaction(...)`，除非它就是这个事务的拥有者。

## 新增一张表

1. `src/db/schema/` 加表定义与迁移（见[开发文档](development.md#规范与最佳实践)的迁移纪律）。
2. `src/repositories/XxxRepository.ts`：`BaseRepository` 子类 + `export const xxxRepositoryFor = singletonFor((db) => new XxxRepository(db))`。同一张表要加重查询时，新建 `XxxReportingRepository.ts` 这类读模型文件，不要在写模型里堆报表 SQL。
3. 选缓存形态：行数固定在几十行 → `tableCacheFor`；行数随租户增长 → `entryCacheFor` 或 `authRepositoryCache`（已有键名时沿用 `authCacheKey`）；按请求增长 → 不缓存。
4. 写方法在 SQL 成功后写穿或失效；跨实体影响要同时清主体标签。
5. 端点/流程改为调用仓储；`npm test -- src/repositories/TableBoundary.test.ts` 必须绿。
6. 行为变化补测试：写后读、失效后读、负结果、提前刷新。

## 改部署形态时

多实例部署会让「写穿只更新本实例」成为错误的前提：需要把写穿换成「提交后广播失效」（或引入短 TTL + 版本号），并重新评估预算读取的延迟窗口。当前所有与缓存相关的判断都建立在单实例之上，文档与代码注释里出现这句前提的地方都要一起改。
