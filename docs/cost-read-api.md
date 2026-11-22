# 公司 Key 只读成本 API

面向持有普通虚拟密钥的公司调用方（当前是 cc-server 的公司驱动器），用于把一次模型调用或一段时间窗口的真实费用，与自己的 `ai_usage_records` 对账。

## 为什么需要它

公司 key 不是 `proxy_admin`，不能读 `/admin/spend/logs` 一类管理面，也不应该拿到 master key。普通代理响应里的 `x-litellm-response-cost` 只适用于非流式请求；`/v1/messages` 的流式响应在首字节时响应头已经发出，费用要等流结束才算出来，所以不能靠这个头对账。

本接口直接读既有的 `LiteLLM_SpendLogs`，不新造账本，也不复制 Dashboard 的日志详情：

- 查询范围固定为**鉴权密钥自己**，即 `LiteLLM_SpendLogs.api_key = 当前 key 的 token 哈希`。
- 不返回 `api_key`、metadata、messages、上游请求/响应正文。
- 不需要 `proxy_admin`、master key 或新角色。

## 鉴权与授权

请求使用公司虚拟密钥：

```http
Authorization: Bearer $LITELLM_COMPANY_KEY
```

也支持 `x-api-key: $LITELLM_COMPANY_KEY`。两条路由挂在现有 `/spend/*` 路由组下，经过与其它消费端点相同的 `authMiddleware` 和 `authorizationGuard("spend")`。

如果这把 key 的 `allowed_routes` 为空，它默认可用；如果配置了白名单，需要加入：

```json
{
  "allowed_routes": ["llm_api_routes", "spend_read_routes"]
}
```

`spend_read_routes` 只包含本页的两条路由，不会顺带放开 `/spend/logs/ui`、`/global/spend/*` 或其它日志详情。也可以不用组名，直接写精确路径：

```json
{
  "allowed_routes": [
    "llm_api_routes",
    "/spend/cost/request",
    "/spend/cost/summary"
  ]
}
```

不需要把 `spend_read_routes` 和 `management_routes` 一起给；给了也不会获得管理面权限。

## 端点

### `GET /spend/cost/request`

按单次请求读取已结算费用。`request_id` 与 `client_request_id` 二选一。

| 参数                | 必填   | 说明                                                                                                    |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `request_id`        | 二选一 | `x-litellm-request-id` 响应头的值；`LiteLLM_SpendLogs.request_id` 主键，最长 512 字符                   |
| `client_request_id` | 二选一 | 调用方发请求时原样使用的 `x-request-id` 或 `idempotency-key`；服务端按与记账完全相同的规则换算成存储 ID |

`request_id` 优先使用响应头。只有在调用方自己保留了原始 `x-request-id` / `idempotency-key` 时才用 `client_request_id`，不要把原始值直接填进 `request_id`。

成功响应（只列主要字段）：

```json
{
  "object": "spend.cost.request",
  "currency": "USD",
  "scope": "key",
  "request_id": "8f14e45fceea167a5a36dedd4bea2543",
  "spend": 0.0123,
  "total_tokens": 1234,
  "prompt_tokens": 1000,
  "completion_tokens": 234,
  "cache_read_input_tokens": 0,
  "cache_creation_input_tokens": 0,
  "start_time": "2026-11-20T10:00:00.000Z",
  "end_time": "2026-11-20T10:00:01.500Z",
  "request_duration_ms": 1500,
  "call_type": "acompletion",
  "model": "standard",
  "model_id": "deployment-1",
  "model_group": "standard",
  "custom_llm_provider": "openai",
  "endpoint": "/v1/chat/completions",
  "status": "success",
  "key_alias": "company-a",
  "unit_prices": { "input": 0.000001, "output": 0.000002 },
  "peak_tier": "peak"
}
```

字段含义：

| 字段                                                      | 类型             | 说明                                         |
| --------------------------------------------------------- | ---------------- | -------------------------------------------- |
| `spend`                                                   | number           | 该请求的美元费用，来自请求结束时冻结的账单行 |
| `total_tokens` / `prompt_tokens` / `completion_tokens`    | number           | 与日志行一致的 token 计数                    |
| `cache_read_input_tokens` / `cache_creation_input_tokens` | number           | 缓存读写 token；没有缓存时为 0               |
| `start_time` / `end_time`                                 | ISO-8601 或 null | UTC 时间，带 `Z`                             |
| `request_duration_ms`                                     | number 或 null   | 请求耗时                                     |
| `model` / `model_group` / `model_id`                      | string           | 逻辑模型、模型组与部署 ID；用于定位计费口径  |
| `custom_llm_provider` / `endpoint` / `call_type`          | string           | 上游 provider、入口路径、调用类型            |
| `status`                                                  | string 或 null   | 日志行状态；按需区分成功、失败与中断         |
| `key_alias`                                               | string 或 null   | 当前 key 的别名，不包含密钥                  |
| `unit_prices`                                             | object 或 null   | 本次请求使用的单价快照；可据此复核 `spend`   |
| `peak_tier`                                               | string 或 null   | 峰谷计价档位，没有该概念时为 null            |

未找到行时返回 `404`。**不属于当前 key 的 request_id 也返回同一个 404**，不通过 403/404 差异暴露其它公司的请求是否存在。

### `GET /spend/cost/summary`

按 UTC 日期窗口汇总当前 key 的费用。`start_date` 与 `end_date` 都必填，格式 `YYYY-MM-DD`，包含 `end_date` 当天，最长 366 天。

| 参数         | 必填 | 说明                                |
| ------------ | ---- | ----------------------------------- |
| `start_date` | 是   | 起始日（UTC），`YYYY-MM-DD`         |
| `end_date`   | 是   | 结束日（UTC，含当天），`YYYY-MM-DD` |
| `model`      | 否   | 只统计指定逻辑模型；最长 512 字符   |

成功响应：

```json
{
  "object": "spend.cost.summary",
  "currency": "USD",
  "scope": "key",
  "start_date": "2026-11-01",
  "end_date": "2026-11-02",
  "model": null,
  "requests": 3,
  "total_spend": 1.25,
  "total_tokens": 1000,
  "prompt_tokens": 600,
  "completion_tokens": 400,
  "cache_read_input_tokens": 10,
  "cache_creation_input_tokens": 20,
  "first_request_at": "2026-11-01T00:00:00.000Z",
  "last_request_at": "2026-11-02T23:59:00.000Z"
}
```

没有匹配行时各项合计为 `0`，`first_request_at` / `last_request_at` 为 `null`。时间窗口内仍在进行的请求不会计入；等它结算后再查。汇总包含窗口内所有已落库行，与既有 spend 报表口径一致，不额外只筛成功状态。

## 费用响应头

推理路由在鉴权之后、处理之前会写：

```http
x-litellm-request-id: <SpendLogs.request_id>
```

- 调用方带了 `x-request-id` 或 `idempotency-key` 时，它是 `SHA-256(authNamespace + NUL + 原值)`；`authNamespace` 是当前 key 的 token 哈希。
- 没带时是随机 UUID。
- 值本身是哈希或 UUID，不包含密钥；不同公司即使发同一个 `x-request-id` 也会得到不同 ID。
- 流式请求也能在响应开始时拿到这个头；此时费用行还没结算，等流结束后再用它查。

这个头是 `x-litellm-response-cost` 的补充，不替代后者：非流式调用仍可直接读 `x-litellm-response-cost`；流式调用必须用 `x-litellm-request-id` + 本接口。

## 错误

| 状态  | 场景                                                                                   | 响应                                                       |
| ----- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `400` | 两个 ID 同时给、两个都没给、ID 超长、日期格式错误、窗口超过 366 天、参数不是单个字符串 | 标准 `{ "error": { "message", "type", "param", "code" } }` |
| `401` | 没有有效密钥                                                                           | 标准错误                                                   |
| `403` | key 的 `allowed_routes` 不包含本接口，或 key 被禁用                                    | 标准错误                                                   |
| `404` | 请求不存在，或不属于当前 key                                                           | 标准错误；两种情况不区分                                   |
| `5xx` | 数据库等内部错误                                                                       | 标准错误，不返回 SQL 或连接信息                            |

## cc-server 消费方式

1. 调 `/v1/messages` 等推理端点时，在拿到响应对象后、消费流之前读取 `x-litellm-request-id`。
2. 流结束后，用 `GET /spend/cost/request?request_id=<该值>` 查询费用；如果返回 404，按短退避重试几次，直到结算行出现。
3. 需要按天/按模型核对总额时，用 `GET /spend/cost/summary?start_date=...&end_date=...&model=...`，与 `ai_usage_records` 的同窗口汇总比较。
4. 不要用 `client_request_id` 猜存储 ID；只有在没有拿到响应头、但保留了自己发出的 `x-request-id` 时才用它。

示例（密钥只从环境变量读取，不写进脚本或日志）：

```bash
curl -sS "$LITELLM_BASE_URL/spend/cost/request?request_id=$REQUEST_ID" \
  -H "Authorization: Bearer $LITELLM_COMPANY_KEY"

curl -sS "$LITELLM_BASE_URL/spend/cost/summary?start_date=2026-11-01&end_date=2026-11-02" \
  -H "Authorization: Bearer $LITELLM_COMPANY_KEY"
```

## 范围与边界

- **公司边界 = 当前 key**。同一把 key 的请求都能读；同一公司的另一把 key、另一家公司的 key 都读不到。这样最符合“公司驱动器只持有一把公司 key”的现状，也避免把“公司”误解成可以跨 key 读取的 team。
- 即使这把 key 所属用户是 `proxy_admin`（cc-server 的 key 就挂在 `default_user_id` 下），范围也仍是这把 key 自己：管理员身份不会把 `scope: "key"` 扩成全局。不要用 `resolveUsageScope(auth, "key")` 求范围——它在管理员不传 key 参数时返回“不限 key”，会把正常鉴权误判成未认证。
- 需要跨 key 汇总时，仍由管理员走既有 `/global/spend/*`、`/team/spend/report`；本接口不提供管理员旁路。
- Dashboard 的 `/spend/logs/ui/:request_id`、`/spend/logs/ui/batch` 与详情 WebSocket 现在也复用同一可见性边界：管理员保持全量，非管理员只能读列表里本来就能看到的那部分 request_id。
- `spend` 是 LiteLLM 记账值，不是上游账单；上游折扣、赠送额度、汇率差异不会在这里体现。
- 时间窗口按 `startTime` 的 UTC 日期切分，跨时区对账时先统一到 UTC。
- 请求仍在进行、尚未写入 `LiteLLM_SpendLogs` 时查不到；流式调用尤其要等流结束。
- 密钥轮换后，新 key 是新 scope；旧请求仍属于旧 key，不能用新 key 读取。

## 验证

```bash
npx jest src/spend/ScopedCostEndpoint.test.ts src/spend/SpendRequestIdHeader.test.ts src/auth/AuthorizationGuard.test.ts --runInBand
TEST_DATABASE_URL=postgres://... npx jest src/spend/ScopedCostEndpoint.integration.test.ts --runInBand
npm run typecheck
npm run test:types
npx eslint src/spend/ScopedCostEndpoint.ts src/spend/SpendRequestIdHeader.ts src/auth/AuthorizationGuard.ts src/spend/SpendManagementEndpoint.ts src/main.ts
```

单元测试覆盖：自己的 key 能按 request_id / client_request_id / 日期窗口读取；SQL 条件始终带当前 key 的哈希；别人的请求返回 404；响应不含 `api_key`、metadata、messages；`spend_read_routes` 不会放开日志详情。另一组用例走真实认证链（`createApiKeyAuth` → `webUiCsrfProtection` → `authorizationGuard("spend")`），验证 `proxy_admin` 角色的 key 也能读到自己的单条与汇总、SQL 仍按 token 哈希过滤，并在缺少 `spend_read_routes` 时仍返回 403。集成测试在真实 PostgreSQL 中插入同一时间窗内两把不同 key 的行，验证单条读取、窗口合计与 `client_request_id` 映射都只命中调用方自己的行；该用例在提供 `TEST_DATABASE_URL` 时才运行。

## 生产生效条件

代码发布后端点自动可用，不需要新增环境变量、迁移或角色。唯一可能需要改的是公司 key 的 `allowed_routes`：若它是非空白名单，加入 `spend_read_routes`（或两条精确路径）。不要为了这个接口发放 master key，也不要改生产容器或数据库。
