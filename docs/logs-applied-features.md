# 日志的 Feature 列与能力标记

Logs 列表的 **Feature** 列回答「这条请求被我们路由的哪些能力处理过」：脱敏替换、fallback、强制改投、alias 展开、推理档位注入、tag 过滤。它读 `SpendLogs.metadata.applied_features`，由网关在请求过程中记录，前端只做图标映射。

## 数据契约

`metadata.applied_features` 是一个数组，没有能力生效时为 `null`，历史行完全没有这个键。

```json
[
  { "id": "privacy", "detail": "EMAIL×2, PHONE×1", "count": 3 },
  { "id": "alias", "detail": "fast → gpt-4o-mini" },
  { "id": "fallback", "detail": "gpt-4o-mini → claude-haiku", "count": 1 }
]
```

- `id` 是稳定契约，前端按它选图标；`detail` 是给人看的具体取值；`count` 是同一能力在一次请求内的次数，为 1 时省略。
- 同 id 只出现一次：现场重复记录时保留首次的具体取值，次数取最大值并随之更新 detail（脱敏统计会随多次上游尝试累积）。
- 认不出的 id 在前端被忽略，后端可以先行增加能力而不影响旧页面。

| id | 含义 | 记录位置 |
| --- | --- | --- |
| `privacy` | 发生了敏感数据替换，发往上游的是占位符 | `src/privacy/PrivacyDispatch.ts` |
| `privacy:blocked` | 命中拒绝替换的规则，请求被拦下且没有上行 | 同上；与 `privacy` 互斥 |
| `fallback` | 首选模型失败后换到备用模型 | 由 `routing_trace` 派生 |
| `fallback:context_window` | 因上下文窗口超限换模型 | 同上 |
| `fallback:content_policy` | 上游因内容策略拒绝后换模型 | 同上 |
| `override` | `override_model_name` 强制改投目标模型组 | `FallbackHandler` + 执行点 |
| `alias` | 请求的模型名经 alias 展开后执行 | 同上 |
| `alias:scheduled` | alias 按每日时段选中目标（峰谷价路由） | 同上 |
| `reasoning_effort:forced` | 强制覆盖调用方的推理档位 | `src/router/ReasoningEffortOverride.ts` |
| `reasoning_effort:default` | 调用方没有指定档位时补默认值 | 同上 |
| `tag_routing` | 按 `metadata.tags` 过滤候选 deployment | `src/router/TagRouting.ts` |

## 采集方式

**请求级 ALS 账本**：`src/router/AppliedFeatures.ts` 提供 `runWithAppliedFeatures()`、`noteAppliedFeature()`、`snapshotAppliedFeatures()`。中间件 `src/middleware/AppliedFeaturesScope.ts` 在每个 HTTP 请求上开作用域，改写请求的代码在决策现场记一笔，落账时读快照。

- 作用域外调用静默忽略：后台任务、健康检查、单元测试都不需要额外处理。
- 内置能力（视觉、生图、网页能力）的内部调用在 `captureUpstreamExchange()` 里开子作用域，它们自己的路由决策不会记到外层用户请求上；对应的审计行显式写入空集合，因为 Feature 列描述的是用户的请求。

## 为什么 fallback 不单独埋点

`routing_trace` 已经是「这一跳为什么换模型」的唯一事实源，详情抽屉也读它。再在决策现场记一遍会制造两套口径，所以落账时按 `routing_type` 归并成上面三个 fallback id，`count` 是跳数。

## 落账与在途行

- 结算行：`SpendTracker.buildSpendLogsMetadata()` 合并「账本快照 + 由 `routing_trace` 派生的 fallback」写入 `applied_features`。
- 在途行：`ActiveRequestJournal.buildActiveRequestRoutingPatch()` 用同一份合并逻辑随上游补写更新，流式请求进行中就能看到图标。
- `spend_logs_metadata_fields` 的 include/exclude 投影把 `applied_features` 与 `status` 一起列为保留键：它是列表固定列，不能被 metadata 字段裁剪清空。

## 前端呈现

- 列定义：`ui/litellm-dashboard/src/features/logs/support/LogsColumnModels.ts`（Model 之后，常驻 180px）。
- 映射与排序：`LogsAppliedFeaturesLogic.ts`——隐私 → fallback → override → alias → 推理档位 → tag，同族同色系。
- 单元格：`LogsFeatureCellComponent.vue`，图标格内换行，`count > 1` 显示次数徽标，悬停给「名称 + 说明 + 具体取值」。
- 历史行（没有 `applied_features` 键）在展示层补标记，口径与后端一致：先按同期的 `routing_trace` 归并出 `fallback` / `fallback:context_window` / `fallback:content_policy`，没有轨迹的老行才退回 `fallback_models`，给一个通用 fallback。键存在但为 `null` 表示确实没有能力生效，按无标记处理。

## 增加一种能力

1. 在 `src/types/spend.ts` 的 `AppliedFeatureId` 加 id。
2. 在决策现场调用 `noteAppliedFeature({ id, detail?, count? })`（fallback 类改 `deriveFallbackAppliedFeatures`）。
3. 前端 `LogsAppliedFeaturesLogic.ts` 加一条映射（图标取自 `UiLucideIconDefinitions.json`，同族选相近图标与色系）。

不需要数据库迁移、新接口或新查询；后端加 id 而前端未跟进时，那一条只是暂时不显示。
