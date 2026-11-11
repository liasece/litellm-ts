# 启动链路、关键路径与预热

本文件说明网关「从进程启动到可以接受请求」这条链路里哪些工作必须等、哪些可以放到后台预热，
以及怎么在真实重启后核对改动效果。启动耗时的取舍会影响服务不可用窗口，改动这条链路前先读本文件。

## 生产实测时间线

2026-11-05 06:24，容器 `litellm-prod` 冷启动（`docker inspect` 的 StartedAt `06:24:38.497Z`），
以下时间点来自容器日志与该次启动写入的 CLIProxy 运行日志：

| 时间点 | 阶段 | 相对容器启动 |
| --- | --- | --- |
| 06:24:39.066 | `LiteLLM TS Gateway 启动中...`（配置已加载，进程与模块导入完成） | 0.57s |
| 06:24:39.183 | `数据库接管与迁移已完成` | 0.69s |
| 06:24:39.624 | CLIProxy 子进程 spawn（`启动 CLIProxy 8.0.52`） | 1.13s |
| 06:24:41.520 | CLIProxy `API server started successfully on: 127.0.0.1:8317` | 3.02s |
| 06:24:41.884 | CLIProxy `full client load complete`（健康检查此时才可用） | 3.39s |
| 06:24:43.315 | `已将旧进程遗留的在途请求标记为 aborted` | 4.82s |
| 06:24:43.341 | `LiteLLM TS Gateway 已启动: http://0.0.0.0:4000` | 4.84s |

结论：4.84 秒里有约 3.7 秒耗在「等 CLIProxy 就绪」上，另外约 0.45 秒耗在远端价格快照拉取上；
数据库接管与迁移只占 0.12 秒，路由装配 26 毫秒。这两项外部依赖的耗时是不可控的：
远端价格快照有 10 秒超时预算，CLIProxy 健康等待有 15 秒超时预算，都直接叠加进不可用窗口。

## 关键路径的划分

必须阻塞到监听之前（正确性依赖）：

- 配置加载与校验；
- 数据库连接、接管与迁移（多实例/多进程互斥依赖迁移锁）；数据库可能与本进程几乎同时
  冷启动，连接在有限预算内等待其就绪，超时或配置类错误仍然立即失败；
- `abortOrphanedActiveRequests()`：必须在本进程开始服务前把旧进程的在途行标成 aborted，
  否则本进程新写入的在途行会被同一条语句误伤，或遗留行永久占用 `LiteLLM_ActiveRequests`；
- 路由装配与 `listen()`。

不进关键路径（可以预热，失败只降级对应能力）：

- 远端模型价格快照拉取：失败本来就会回退镜像内置的 bundled 快照；
- 内置 CLIProxy 子进程的 install/project/spawn/健康检查：缺少二进制、插件异常或上游
  token 刷新失败都不应该让网关自己不启动。

## 现在的实现

- `src/container.ts`：`createServiceContainer()` 只做关键路径的工作，并在返回的容器上暴露
  幂等的 `warmUp()`；`warmUp()` 用 `Promise.all` 并行执行 `model_cost_map` 与
  `cliproxy_runtime` 两段预热，异常统一收敛成日志，不会向调用方抛错。
- `src/main.ts`：容器创建后立刻 `void container.warmUp()`，与遗留在途请求回收、路由装配、
  `listen()` 并行；「已启动」日志带 `startupMs`，即真正可以接客的时刻。
- `src/core/db/Database.ts`：`initialize()` 先取得一条已通过 `SELECT 1` 的连接。数据库报
  `57P03`（尚未接受连接）、`57P01`（管理员关停）或建连阶段出现 `ECONNREFUSED`/`ENOENT`/
  `ETIMEDOUT`/`ECONNRESET` 时按 1 秒间隔重试，预算 60 秒；认证失败、库不存在一类配置错误
  不等待。机器重启后应用与 PostgreSQL 同时拉起时，不再先启动失败一次、再依赖容器 restart
  策略拉起（2026-11-10 21:17 的生产重启出现过该失败）。
- `src/cliproxy/CliProxyRuntimeManager.ts`：`initialize()` 进入与管理操作共用的串行队列
  （监听之后管理接口已经可以访问，避免配置投影/版本安装与手工操作互相踩），每一步之前检查
  停止意图；`_waitForHealth()` 在停止意图下发或子进程退出后立即返回，不再空转到超时；
  健康轮询间隔 50ms，就绪判定不再固定多等最多 250ms。
- `src/cliproxy/CliProxyModelCatalog.ts`：健康之后还要等「模型可解析」。`/healthz` 只代表 HTTP
  服务已在听，托管插件是在 listen 之后才把模型注册进目录的；这期间用插件前缀的模型会被 CPA
  判成 `unknown provider`，请求先吃一次 400 再走 fallback。启动流程用 `/v1/models` 等到
  `opencode-go/`、`commandcode/` 前缀出现（上限 `MODEL_CATALOG_TIMEOUT_MS`，3 秒），
  再置 `running`；超时只记日志、不阻断启动，未就绪模型仍由 fallback 兜底。
- `src/cliproxy/CliProxyStartupGate.ts`：请求侧的启动等待。挂在绑定请求级运行时配置之后，
  当请求解析到的模型组包含 CLIProxy deployment 且子进程仍在预热时，最多等待
  `CLIPROXY_STARTUP_WAIT_MS`（默认 5000，0 关闭）让子进程就绪，再继续原请求；已经
  `running`、已禁用、已停止、崩溃循环、升级排空或超时都按原逻辑 fallback。
  覆盖核心代理链与 stub 链（含原生 Responses/passthrough 端点），WebSocket passthrough 不在其中。

启动日志里新增两类可核对字段：

- `启动预热完成 {"totalMs":…,"steps":{"model_cost_map":…,"cliproxy_runtime":…}}`；
- `LiteLLM TS Gateway 已启动 ... {"startupMs":…}`。

## 下次重启后的验证方式

1. 冷启动后读容器日志首屏：`已启动` 的 `startupMs` 应该落在 1 秒量级，且出现在
   `启动预热完成` 之前；`启动预热完成` 的两段耗时之和应接近原来那 3.7 秒。
2. 用 `/health/liveliness` 观察端口可用时刻（Docker healthcheck 用的就是它），
   用 `/cliproxy/status` 的 `state` 观察子进程就绪时刻：前者会明显早于后者。
3. 在预热窗口内直接请求一个 `commandcode/` 模型：预期请求多等约 1~3 秒后由 CLIProxy 正常返回，
   日志出现 `CLIProxy 启动窗口内已就绪，继续使用请求的模型` 与 `CLIProxy 模型目录就绪（健康后等待 …ms）`，
   SpendLogs 的 `model` 是 `cliproxy/commandcode/...`、`attempted_retries` 为 0。
   若 CPA 启动失败或超时，则记录 `CLIProxy 启动窗口内未就绪，按 fallback 继续`
   与 `CLIProxy 模型目录 …ms 内未就绪（缺少 …）`，并维持原 fallback 行为。

## 已知边界

- 预热把 CLIProxy 的就绪时间从「服务不可用」改成「该子进程路由短暂不可用」。启动等待闸门
  在这段窗口里让请求等子进程就绪而不是静默换成 fallback 模型，代价是启动后的首批请求各多
  1~2 秒延迟；等待有上限，CPA 起不来时仍然 fallback。直连 WebSocket passthrough 不经过该闸门。
- 预热期间 `/cliproxy/status` 会短暂显示 `starting`；Dashboard 的 CLIProxy 页面此时刷新
  可能看到未就绪状态，不需要处理。
- 如需回滚：把 `warmUp()` 里的两段 `run` 改回在 `createServiceContainer()` 中直接 `await`
  （价格快照）和 `await …catch()`（CLIProxy）即可，其余代码不依赖预热顺序。

## 不属于本次改动、但值得单独处理的观察

- `LiteLLM_SpendLogs` 的 TOAST 段约 321GB（主表 1.2GB、索引 419MB，84 万行），
  `LiteLLM_ActiveRequests` 8 行占 60MB。启动时的 aborted 回收只搬运个位数行（每行约 250KB），
  不是启动瓶颈，但会让备份、`VACUUM`、日志详情查询持续变重，需要单独评估清理策略。
  其中在途行正文已在 2026-11-10 改为内容寻址块引用（见
  [upstream-alignment.md](upstream-alignment.md)），行宽不再随会话增长；`LiteLLM_SpendLogs`
  的历史 TOAST 段仍需要单独评估清理策略。
- CLIProxy 运行目录下 `logs/` 已积累 312MB / 55 个文件（`error-v1-responses-*.log` 每个约
  3.3MB，没有轮转），`versions/` 有 634MB 历史二进制。与启动无关，属于磁盘治理。
