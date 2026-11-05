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
- 数据库连接、接管与迁移（多实例/多进程互斥依赖迁移锁）；
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
- `src/cliproxy/CliProxyRuntimeManager.ts`：`initialize()` 进入与管理操作共用的串行队列
  （监听之后管理接口已经可以访问，避免配置投影/版本安装与手工操作互相踩），每一步之前检查
  停止意图；`_waitForHealth()` 在停止意图下发或子进程退出后立即返回，不再空转到超时。

启动日志里新增两类可核对字段：

- `启动预热完成 {"totalMs":…,"steps":{"model_cost_map":…,"cliproxy_runtime":…}}`；
- `LiteLLM TS Gateway 已启动 ... {"startupMs":…}`。

## 下次重启后的验证方式

1. 冷启动后读容器日志首屏：`已启动` 的 `startupMs` 应该落在 1 秒量级，且出现在
   `启动预热完成` 之前；`启动预热完成` 的两段耗时之和应接近原来那 3.7 秒。
2. 用 `/health/liveliness` 观察端口可用时刻（Docker healthcheck 用的就是它），
   用 `/cliproxy/status` 的 `state` 观察子进程就绪时刻：前者会明显早于后者。
3. 在预热窗口内直接请求一个 `commandcode/` 模型，预期是上游连接错误（CLIProxy 还没监听）
   而不是网关自身不可用；窗口结束后同一请求恢复正常。

## 已知边界

- 预热把 CLIProxy 的就绪时间从「服务不可用」改成「该子进程路由短暂不可用」。本次发布的
  切换本身就是一次性停机，因此这段窗口不劣于原状态，但不是零成本：预热期间走 CLIProxy 的
  请求会失败或落到 Router fallback。要彻底消除这段窗口，需要在 CLIProxy 请求路径上加
  bounded wait（等就绪但不无限等），这会改动请求链路的超时语义，属于独立改动。
- 预热期间 `/cliproxy/status` 会短暂显示 `starting`；Dashboard 的 CLIProxy 页面此时刷新
  可能看到未就绪状态，不需要处理。
- 如需回滚：把 `warmUp()` 里的两段 `run` 改回在 `createServiceContainer()` 中直接 `await`
  （价格快照）和 `await …catch()`（CLIProxy）即可，其余代码不依赖预热顺序。

## 不属于本次改动、但值得单独处理的观察

- `LiteLLM_SpendLogs` 的 TOAST 段约 321GB（主表 1.2GB、索引 419MB，84 万行），
  `LiteLLM_ActiveRequests` 8 行占 60MB。启动时的 aborted 回收只搬运个位数行（每行约 250KB），
  不是启动瓶颈，但会让备份、`VACUUM`、日志详情查询持续变重，需要单独评估清理策略。
- CLIProxy 运行目录下 `logs/` 已积累 312MB / 55 个文件（`error-v1-responses-*.log` 每个约
  3.3MB，没有轮转），`versions/` 有 634MB 历史二进制。与启动无关，属于磁盘治理。
