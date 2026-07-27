# LiteLLM TS 仓库操作说明

## 生产环境与部署边界

- 生产环境是单点服务，不需要设计或执行集群滚动发布。
- 采用一次性全量部署，可以接受部署期间服务停机。
- 本地仓库 `/Users/jansen/jl3/src/jtllab/litellm-ts` 是远程服务器
  `/root/var/src/jtllab/litellm-ts` 的 Samba 映射。修改本地文件后，远程目录已经同步，
  不要再执行 `scp`、`rsync` 或其他代码同步操作。
- 远程主机通过 `ssh root@jl3ssh.gamefantasy.com` 访问。用户交互环境中也可能称其为
  `sshjl3`。
- 不要在命令输出、日志摘要或回复中展示部署脚本包含的密钥、数据库连接串等敏感信息。

## 部署前验证

至少完成以下检查：

```sh
git diff --check
node node_modules/typescript/bin/tsc --noEmit
```

远程非交互 SSH 环境默认可能找不到 Node.js，需要先设置：

```sh
export PATH=/root/var/ci/github-action-pacificx-unity-1/actions-runner/_work/_tool/node/22.21.1/x64/bin:$PATH
```

后端完整验证命令：

```sh
cd /root/var/src/jtllab/litellm-ts
npm run build
npx jest --silent
```

截至 2026-07-27，完整后端基线为 1191 个测试通过、25 个跳过、0 个失败。
如果只改动 Logs 查询，可先运行：

```sh
npx jest --runInBand --silent --runTestsByPath \
  src/spend/SpendManagementEndpoint.test.ts \
  src/core/db/Database.integration.test.ts
```

前端独立 `npx tsc --noEmit` 会被仓库内既有测试夹具类型错误阻塞，不能单独作为发布门禁。
应以部署脚本执行的 Next.js production build 是否成功为准；改动的前端文件仍应单独执行
ESLint。

## 正式部署

标准部署命令：

```sh
ssh root@jl3ssh.gamefantasy.com
sh '/root/var/tools/service/ai-out-service/restart-litellm.sh'
```

自动化或非交互执行时使用：

```sh
ssh root@jl3ssh.gamefantasy.com \
  'export PATH=/root/var/ci/github-action-pacificx-unity-1/actions-runner/_work/_tool/node/22.21.1/x64/bin:$PATH; \
   sh '\''/root/var/tools/service/ai-out-service/restart-litellm.sh'\'''
```

部署脚本会依次：

1. 构建 TypeScript 后端。
2. 构建 Next.js 前端。
3. 构建并校验 `litellm-prod` Docker 镜像。
4. 对生产数据库执行只读预检。
5. 停止并删除旧 `litellm-prod` 容器。
6. 启动新容器；应用启动时执行 Drizzle migration。
7. 等待容器健康检查。

数据库迁移较大时可以设置 `HEALTH_CHECK_TIMEOUT=1800`，但 Docker 内置 healthcheck
仍可能在迁移期间先把容器标记为 `unhealthy`，从而让部署脚本提前返回失败。此时不要立即
重启或删除容器；先判断迁移是否仍在运行。

## 部署后检查

首先确认容器没有退出或 OOM：

```sh
ssh root@jl3ssh.gamefantasy.com \
  'docker ps -a --filter name=litellm-prod --format "{{.Names}} {{.Status}}"'
```

按用户要求持续查看日志：

```sh
ssh root@jl3ssh.gamefantasy.com
docker logs litellm-prod -f
```

日志至少应出现：

- `数据库接管与迁移已完成`
- `健康检查路由已注册`
- `LiteLLM TS Gateway 已启动`

然后验证外部入口：

```sh
curl -sS -o /dev/null -w 'health_status=%{http_code} health_time=%{time_total}\n' \
  https://litellm.gamefantasy.com/health/liveliness
curl -sS -o /dev/null -w 'ui_status=%{http_code} ui_time=%{time_total}\n' \
  'https://litellm.gamefantasy.com/ui/?page=logs'
```

两者都应返回 HTTP 200。还需要使用容器已有的 master key 环境变量，从容器内部请求
`/spend/logs/ui`，验证真实认证查询返回 200、50 行数据以及每行都有
`session_total_count`。不得打印 master key。

若迁移期间服务尚未监听 4000，可从容器内连接 PostgreSQL，检查 `pg_stat_activity`。
只要容器仍为 running、没有 OOM，并且 migration SQL 仍为 active，就继续等待，不要打断
事务。迁移提交后再等待 Docker 状态恢复为 `healthy`。

## Logs 查询性能约束

`LiteLLM_SpendLogs` 目前是大 JSON 表。2026-07-27 部署时约 11 GB、约 12 万行。
禁止在 `/spend/logs/ui` 的刷新路径上读取或解析全表 `metadata`。

会话聚合必须使用持久化的 `session_group_key`：

- `c:<claude_code_user_id>`：Claude Code 会话。
- `s:<session_id>`：普通会话；部分客户端会把稳定 `session_id` 放在
  `metadata.spend_logs_metadata.user_id` 的 JSON 字符串中，此值优先于请求级顶层 `session_id`。
- `r:<request_id>`：没有 session 的请求。

数据库迁移 `drizzle/0002_session_group_key.sql` 创建生成列及
`idx_spend_logs_session_group_time` 复合索引。列表 enrichment 和 session detail 都必须
使用 `session_group_key` 等值查询。修改相关逻辑后，应使用
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` 确认计数查询为
`Index Only Scan` 或等价索引计划，不能退化为全表扫描。

Logs 页面仅在第一页且开启 live tail 时每 15 秒刷新，并且
`refetchIntervalInBackground` 必须保持为 `false`，避免后台标签持续制造数据库负载。
Request Logs 主列表必须逐条展示分页 API 返回的请求，不得按 Session 聚合、去重或折叠。
Session 分组仅用于用户点击某条日志后，在详情 Drawer 中加载并展示该 Session 的全部日志。
Session Drawer 会单独请求 `/spend/logs/session/ui`，必须消费 `snapshot + next_cursor` 拉完所有页，
并校验加载后的唯一 `request_id` 数量等于服务端 `total`；列表按 `startTime` 倒序排列，最新日志
始终显示在最上面。

2026-07-27 上线后的生产参考值：24 小时窗口、`page_size=50`、约 6215 条日志时，
首次请求约 100–153 ms，热查询约 14–17 ms；会话计数样本索引查询约 0.029 ms。
这些数字仅作为回归参考，判断时还要结合当时数据量和缓存状态。
