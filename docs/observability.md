# 服务观测性

这份文档说明本服务内置的观测能力：能回答什么问题、指标与日志在哪里、出问题按什么顺序看。
它是性能优化与线上排障的事实入口，不依赖任何外部监控组件。

## 为什么自带

线上的「接口慢」有三种完全不同的成因，混在一起看永远分不清：

1. **本地开销**：鉴权链、运行时配置、在途登记各自串行查库，某些请求在调用上游前就已经花了 1-2 秒；
2. **上游慢**：等响应头久，或者首个内容块久（生成阶段）；
3. **自身阻塞**：单事件循环被 JSON 序列化、同步日志、GC 暂停或记账事务尾巴占住。

因此观测按「阶段」切分，而不是只报一个端到端耗时。所有指标都带请求级轨迹 ID，日志行可以与指标、慢请求明细互相对应。

## 采集开关

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `LITELLM_OBSERVABILITY_ENABLED` | 不设置即开启 | 设为 `false` 关闭全部采集与端点（端点返回 404） |

关闭后不做任何计时、不注册中间件，请求路径回到接入前的行为。

## 端点

三个端点都挂在认证之后：模型名、流量分布与耗时结构属于运营数据，不对外公开。
用 master key 或任一有效虚拟密钥访问，例如在容器内：

```bash
# Prometheus 文本（推荐给抓取器）
curl -s -H "x-litellm-api-key: $LITELLM_MASTER_KEY" http://127.0.0.1:4000/metrics

# 人读的 JSON 概览，window 为统计窗口秒数（默认 300，范围 15-3600）
curl -s -H "x-litellm-api-key: $LITELLM_MASTER_KEY" "http://127.0.0.1:4000/metrics/summary?window=300"

# 最近的慢请求与失败请求明细（最新在前）
curl -s -H "x-litellm-api-key: $LITELLM_MASTER_KEY" "http://127.0.0.1:4000/metrics/slow?limit=20"
```

`/metrics/summary` 的窗口统计来自内存里的 5 分钟环形分片，不查库，因此可以在事故现场高频调用。

## 请求时间轴

一次推理请求被切成 14 段。`/metrics/summary` 的 `llm` 段对应其中可测量的阶段：

| # | 阶段 | 指标 | 说明 |
| --- | --- | --- | --- |
| 1 | 请求到达 | `litellm_http_request_duration_seconds` | 观测中间件是整条链的第一个中间件 |
| 2 | 请求体就绪 | 无独立指标（含在 `pre_upstream` 内） | zstd 解压 + `JSON.parse` 都是同步 CPU |
| 3 | 认证完成 | 无独立指标（含在 `pre_upstream` 内） | 鉴权通过即打点，失败请求不会记成成功 |
| 4 | 运行时配置 | 同上 | 每请求 1 个只读事务 |
| 5 | 部署选定 | 同上 | 路由决策本身不查库 |
| 6 | 记账预留 | 同上 | 在途登记事务 |
| 7-8 | 上游响应头 | `litellm_llm_upstream_headers_seconds` | 按上游主机分组，能区分是哪个上游慢 |
| 9 | 首字（模型开始产出） | `litellm_llm_ttfb_seconds` | 上游吐回第一块内容的时刻。客户端看到的第一个字节可能只是本地合成的前言或 4KB 填充帧，由 `litellm_llm_first_byte_seconds` 单独记录 |
| 10 | 上游流结束 | 无 | 当前未单独打点 |
| 11-12 | 响应结束 | `litellm_llm_stream_duration_seconds` | 首字到响应结束 |
| 13 | 记账提交 | `litellm_spend_write_seconds` | 流式请求发生在响应之后 |
| 14 | handler 返回 | 无 | — |

派生量：

- `pre_upstream = 上游请求发出时刻 - 请求到达`：本地开销总和，是「首字慢但不是上游慢」的直接证据；
- `proxy_overhead = 首字 - 上游首个内容块`：代理自身转换与写出的开销；
- `llm_pre_upstream_db_queries`：上游调用前累计的数据库往返次数，直接对应鉴权 + 运行时配置 + 在途登记的扇出规模。

## 指标目录

所有指标以 `litellm_` 为前缀，标签值截断到 120 字符，每个直方图最多 1000 条序列（超出部分计入 `litellm_observability_dropped_series`）。

### HTTP

| 指标 | 类型 | 标签 | 含义 |
| --- | --- | --- | --- |
| `litellm_http_requests_total` | counter | `route` `method` `status` | 请求数；`route` 已归一化（数字与长 ID 段变 `:id`，超三段折叠 `/*`） |
| `litellm_http_request_duration_seconds` | histogram | `route` `method` | 端到端耗时 |
| `litellm_http_response_bytes` | histogram | `route` | 写回字节数 |
| `litellm_http_in_flight` | gauge | — | 同时在处理的请求数 |

### 推理

| 指标 | 类型 | 标签 | 含义 |
| --- | --- | --- | --- |
| `litellm_llm_requests_total` | counter | `model` `provider` `stream` `status` | `status` 为 `ok` / `error`（含 4xx/5xx）/ `aborted`（客户端断开） |
| `litellm_llm_request_duration_seconds` | histogram | `model` `stream` | 推理请求端到端 |
| `litellm_llm_first_byte_seconds` | histogram | `model` `stream` | 客户端收到第一个字节（可能只是心跳/填充帧） |
| `litellm_llm_ttfb_seconds` | histogram | `model` `stream` | 首字：请求到达 → 上游开始输出 |
| `litellm_llm_pre_upstream_seconds` | histogram | `model` | 上游请求发出前的本地耗时 |
| `litellm_llm_pre_upstream_db_queries` | histogram | — | 上游前的数据库往返次数 |
| `litellm_llm_upstream_headers_seconds` | histogram | `provider` | 等待上游响应头 |
| `litellm_llm_proxy_overhead_seconds` | histogram | `model` | 上游首块到客户端首内容；本地前言早于上游时不记录（差值为负无意义） |
| `litellm_llm_stream_duration_seconds` | histogram | `model` | 首字到响应结束 |
| `litellm_llm_upstream_attempts_total` | counter | `provider` `outcome` | 上游尝试与重试次数 |
| `litellm_llm_tokens_total` | counter | `model` `kind` | `kind` 为 `prompt` / `completion`，记账成功时累加 |

### 数据库

| 指标 | 类型 | 标签 | 含义 |
| --- | --- | --- | --- |
| `litellm_db_queries_total` | counter | `op` `outcome` | 语句数与失败数 |
| `litellm_db_query_duration_seconds` | histogram | `op` | 语句耗时 |
| `litellm_db_pool_wait_seconds` | histogram | — | 从池里取连接的等待 |
| `litellm_db_pool_connections` | gauge | `state` | `total` / `idle` / `waiting` / `max` |
| `litellm_db_slow_queries_total` | counter | `op` | 超过 200ms 的语句 |

### 进程

| 指标 | 类型 | 标签 | 含义 |
| --- | --- | --- | --- |
| `litellm_process_event_loop_delay_seconds` | gauge | `quantile` | 事件循环延迟 p50/p95/p99，每秒刷新 |
| `litellm_process_event_loop_delay_max_seconds` | gauge | — | 启动以来最大停顿 |
| `litellm_process_memory_bytes` | gauge | `kind` | `rss` / `heap_used` / `heap_total` / `external` / `array_buffers` |
| `litellm_process_cpu_seconds_total` | counter | `mode` | 用户态/内核态 CPU |
| `litellm_process_uptime_seconds` | gauge | — | 运行时长 |
| `litellm_process_start_time_seconds` | gauge | — | 进程启动时刻（Unix 秒），用于对齐外部事件与日志 |
| `litellm_process_active_resources` | gauge | `kind` | 活跃句柄/请求数，按类型分组 |
| `litellm_nodejs_gc_duration_seconds` | histogram | `kind` | GC 暂停 |
| `litellm_nodejs_gc_collections_total` | counter | `kind` | GC 次数 |

### 记账

| 指标 | 类型 | 标签 | 含义 |
| --- | --- | --- | --- |
| `litellm_spend_write_seconds` | histogram | — | 记账落库耗时 |
| `litellm_spend_write_failures_total` | counter | — | 记账失败数 |

## 日志

结构化字段都带 `traceId`，可与 `/metrics/slow` 的记录对应。只在需要时打，不刷成功请求：

| 级别 | 触发条件 | 关键字段 |
| --- | --- | --- |
| `warn` | 推理请求首字 > 3s 或总耗时 > 120s；其他请求总耗时 > 2s | `totalMs` `ttfbMs` `preUpstreamMs` `upstreamHeadersMs` `proxyOverheadMs` `streamMs` `dbQueries` `attempts` |
| `error` | 推理路径 4xx/5xx 且未断开 | 同上 |
| `warn` | 语句 > 200ms | `op` `durationMs` `sql`（形态指纹：字面量与参数替换成 `?`，不泄露内容） |
| `warn` | 记账 > 1.5s | `durationMs` `route` `model` |
| `warn` | 事件循环单次停顿 > 200ms | `maxMs` `p99Ms` |
| `error` | 连接池空闲连接异常 | `error` |
| `debug` | 每个请求（仅 debug 级别开启时） | 完整阶段分解 |

调试单个请求时把日志级别调到 `debug`，就能拿到逐段耗时，不需要改代码。

## 排查顺序

按这个顺序看，通常三步之内能定位：

1. **`llm.ttfb_ms.p95` 高，但 `upstream_headers_ms.p95` 低** → 问题在本地：
   - 看 `pre_upstream_ms`；若它占了首字的大部分，再看 `pre_upstream_db_queries`（多少往返）与 `db.query_duration`（每次多慢）；
   - 若 `pre_upstream` 不高但 `event_loop_delay` 的 p99/`max` 很高 → 事件循环被占住，配合 `process_memory_bytes` 与 `gc_duration` 判断是内存压力还是同步工作。
2. **`upstream_headers_ms` 高** → 上游连接或排队慢，按 `provider` 标签分组看是哪一个上游；结合 `attempts_total{outcome="error"}` 判断是否在重试。
3. **首字正常但 `request_duration` 高** → 看 `stream_duration`（生成慢）与 `spend_write`（响应后的尾巴）。
4. **`db.pool.waiting` 长期 > 0** → 连接池打满。`db.pool.max` 是生效上限；如果它比预期小，检查运行时配置是否在池创建之后才加载。
5. **错误率升高** → `http.by_status` 看状态码分布，`llm.by_model` 的 `errors` 看是哪些模型/上游。

## 已知边界

- **CLIProxy 透传**：直接 pipe 上游字节，没有「上游尝试」记录，因此这类请求的 `provider` 标签是 `unknown`、也没有 `upstream_headers` 指标；首字、总耗时、流时长、数据库与进程指标仍然完整。
- **首字口径**：`llm.ttfb_ms` 取「上游开始输出」的时刻，而不是客户端的第一个字节。原因见线上实测——`/responses` 会在
  调用上游前先给客户端写 4KB 填充帧与本地合成事件（约 150ms 到达），而上游真正开始产出在 3s 左右；若按第一个字节算首字，
  会把 3s 的模型等待读成 150ms。想区分两者就看 `llm.first_byte_ms` 与 `llm.ttfb_ms` 的差。
- **百分位口径**：窗口分位来自 5 分钟内存分片，按桶上界线性插值（与 `histogram_quantile` 同口径）。桶很粗时（例如 `db` 的毫秒级桶），分位是区间估计而不是精确样本值。
- **`upstreamPayloadMs` 只对非流式有意义**：流式请求永远读不完响应体，只有首块时刻。
- **没有部署 Prometheus 服务端**：`/metrics` 目前供人工与临时抓取使用；接入抓取器时按上面的 curl 形式配置抓取目标与密钥头。
- **序列上限**：单个直方图 1000 条序列，超出丢弃并计入 `litellm_observability_dropped_series`；`route`、`model`、`provider` 都是低基数标签，不会随请求参数增长。
