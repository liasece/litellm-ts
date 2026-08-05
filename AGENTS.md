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

## SMB 挂载与命令执行位置

- 本地目录是远端目录的 SMB 挂载，文件内容会自动同步，但在本地对仓库执行 Git、npm、
  Node.js、npx 或其他需要密集访问大量小文件的命令可能明显变慢。实际抽样中，本地
  `git status --short` 和 `git diff --check` 分别约需 7 秒和 3 秒，而在远端
  `cc-server-dc` 容器中约需 84 毫秒和 26 毫秒。
- SMB 挂载还可能阻止直接执行 `node_modules/.bin` 下的脚本；例如本地执行
  `npm exec --offline -- tsc --version` 曾因 `/usr/bin/env: bad interpreter:
  Operation not permitted` 失败。同一命令在 `cc-server-dc` 中可以正常运行。
- 因此 Git 状态检查、diff、npm/npx 脚本、类型检查、测试和其他文件系统密集型命令，
  优先通过 `sshjl3` 上的 `cc-server-dc` 容器执行。容器已经挂载同一仓库，路径为
  `/root/var/src/jtllab/litellm-ts`，不需要复制或同步代码。例如：

```sh
ssh root@jl3ssh.gamefantasy.com \
  'docker exec -w /root/var/src/jtllab/litellm-ts cc-server-dc git status --short'

ssh root@jl3ssh.gamefantasy.com \
  'docker exec -w /root/var/src/jtllab/litellm-ts cc-server-dc npm run build'
```

- 需要执行多条命令、管道或 shell 展开时，在容器中启动 shell：

```sh
ssh root@jl3ssh.gamefantasy.com \
  'docker exec -w /root/var/src/jtllab/litellm-ts cc-server-dc \
   sh -lc '\''git diff --check && node node_modules/typescript/bin/tsc --noEmit'\'''
```

- `cc-server-dc` 当前默认使用 Node.js v24，而正式部署脚本使用固定的 Node.js v22。
  容器适合日常快速检查；需要严格验证生产 Node.js 版本兼容性时，仍以正式部署脚本及其
  production build 结果为准。

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

## 测试质量

- 只新增能够验证可观察行为、业务契约、重要逻辑分支或明确回归风险的测试。
- 不得为了形式上的“修改配测试”而添加仅重复静态配置或实现细节的断言，例如直接读取列定义，
  再断言一个已删除的列名不存在。
- 新增回归测试时，应能说明它在修复前为何失败、在修复后验证了什么真实行为；如果简单的展示配置
  变更没有值得自动化验证的行为，可以只运行现有相关测试、类型检查、构建及必要的页面验证。
- 不以测试数量或覆盖率数字代替测试价值；测试不应因无关重构或文案调整而频繁失败。

## 修复任务的交付闭环

- 对本仓库生产功能的缺陷修复或行为调整，完成代码和部署前验证后，必须部署到正式环境并自行完成
  上线核验；除非用户明确要求只修改代码、只诊断或不要部署，不得把“本地修改完成”作为任务终点。
- 上线核验必须覆盖用户报告的具体现象。涉及已有日志或数据时，应直接复查对应记录；涉及前端展示时，
  应在真实生产页面验证可观察结果，不能只以单元测试、构建成功或搜索压缩产物代替功能验证。
- 如果部署或上线核验失败，应先定位并修复根因，再重新验证和部署；只有正式环境中的目标功能正确、
  容器健康且规定的接口检查全部通过后，才能报告任务完成。

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
