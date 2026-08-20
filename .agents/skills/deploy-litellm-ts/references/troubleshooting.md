# 生产运维与故障诊断参考

本文件在 `$deploy-litellm-ts` 触发后按需加载。记录的是定位入口和安全诊断方法，不是无需核实即可
执行的永久配置。生产变更前必须用当前脚本、主机配置和现场状态复核。

## 目录

- 已知拓扑与事实源
- 工具链与发布前验证
- 标准部署与上线核验
- 构建疑似卡住
- Next.js 外部字体死锁
- 安全停止容器替换前的构建
- 生产容器已经缺失
- 迁移或健康检查超时
- Samba 共享依赖的平台错配
- 脏工作区和并发 Git 活动

## 已知拓扑与事实源

以下值用于开始调查，使用前逐项确认：

| 项目         | 已知入口                                                    | 当前事实源                           |
| ------------ | ----------------------------------------------------------- | ------------------------------------ |
| 远程主机     | `root@jl3ssh.gamefantasy.com`（交互中也可能称 `sshjl3`）    | SSH 配置与用户本轮指定               |
| 远程仓库     | `/root/var/src/jtllab/litellm-ts`                           | 当前 Samba 映射与远端 `pwd`          |
| 验证容器     | `cc-server-dc`                                              | `docker inspect` 及其仓库挂载        |
| 生产容器     | `litellm-prod`                                              | `docker inspect`、部署脚本与服务配置 |
| 标准部署入口 | `/root/var/tools/service/ai-out-service/restart-litellm.sh` | 主机当前服务配置与脚本               |

- 本地 checkout 与远端仓库是同一 Samba 内容面，不执行 `scp`、`rsync` 或二次源码同步。
- `cc-server-dc` 只用于 Git、Node.js、类型检查、测试和构建等验证；标准部署脚本在 SSH 宿主机运行。
- 脚本、容器或路径与表格不一致时，以只读现场证据为准。不能唯一确认时停止，不同时尝试多个入口。

## 工具链与发布前验证

不要在文档中固化 Node.js 补丁版本或 CI tool-cache 绝对路径。非交互 SSH 找不到 Node.js 时：

1. 从当前 `package.json#engines`、标准部署脚本和主机工具链配置确认所需版本范围。
2. 在主机上确认将使用的 `node`、`npm` 实际路径与版本；只有来源一致时才把其 bin 目录临时加入
   该次部署命令的 `PATH`。
3. 若只能看到多个候选工具链而无法确定标准版本，停止并报告，不按“最新版本”猜测。

从当前 `package.json` 读取脚本。后端通常执行：

```sh
git diff --check
npm run typecheck
npm run build
npm test
```

只改动特定模块时可以先运行聚焦测试获得快速反馈；正式发布前仍按改动风险完成全部相关门禁。不要
维护固定的通过/跳过测试数量，因为测试集合会随仓库变化。

向 npm script 透传额外参数前先检查该 script 已包含的选项，避免把互斥参数叠加后误判为代码失败；
例如 Jest 的 `--runInBand` 不能与 script 已有的 `--maxWorkers` 同时使用。

前端验证前读取 `ui/litellm-dashboard/AGENTS.md`，再从其 `package.json` 选择相关 ESLint、Vitest、
TypeScript 检查与 `npm run build`。独立检查若命中已知基线问题，必须区分本次回归与既有问题。

在验证容器中运行命令时，先确认它仍挂载当前远端仓库，再以当前路径作为 `docker exec -w`；不要在
这里复制一套可能漂移的固定命令。

## 标准部署与上线核验

生产是单实例服务，标准发布会一次性替换容器并允许短暂停机。部署授权明确、门禁通过且工具链确认后：

1. SSH 到已确认的远程主机。
2. 必要时仅为本次命令设置已确认的 Node.js `PATH`。
3. 在宿主机执行已确认的标准部署入口，不在 `cc-server-dc` 内执行。
4. 观察后端构建、Dashboard production build、镜像构建/校验、数据库只读预检、旧容器切换、
   新容器启动/迁移和健康检查。

基础核验：

```sh
docker ps -a --filter name=litellm-prod --format "{{.Names}} {{.Status}}"
curl -sS -o /dev/null -w 'health_status=%{http_code} health_time=%{time_total}\n' \
  https://litellm.gamefantasy.com/health/liveliness
curl -sS -o /dev/null -w 'ui_status=%{http_code} ui_time=%{time_total}\n' \
  'https://litellm.gamefantasy.com/ui/?page=logs'
```

两条外部入口当前均应返回 HTTP 200。读取有限范围日志确认服务可用，不持续输出无关历史日志。

只有改动涉及 Logs 查询或其响应契约时，才使用容器已有的 master key 从容器内部请求
`/spend/logs/ui`，验证 HTTP 状态、分页/行数及受影响字段（例如 `session_total_count`）。不得打印
master key、环境变量、Authorization 内容或完整敏感响应。

## 构建疑似卡住

保留当前部署会话，在另一个只读 SSH 会话中进入 `cc-server-dc` 后检查部署进程：

```sh
docker exec -it cc-server-dc sh
pgrep -af "restart-litellm|npm run build|next build"
ps -o pid,ppid,pgid,sid,etime,state,%cpu,%mem,command -p <已确认的 PID 列表>
docker ps --filter name=litellm-prod --format "{{.Names}} {{.Status}}"
```

从本文件的已知拓扑开始，并用当前挂载与 `pwd` 确认远程仓库路径，再检查构建目录最近是否仍有文件
写入。不要直接照抄历史路径。

区分以下状态：

- CPU 活跃或构建文件仍在更新：继续等待。
- 父进程和工作进程都长期等待、构建文件不再变化、网络连接也没有数据：调查死锁。
- 进程已经退出：读取部署会话中的明确错误。

没有输出不等于失败。观察期间持续向用户报告简短状态。

## Next.js 外部字体死锁

`next/font/google` 可能使 `next build` 依赖外部 TLS 响应。典型信号包括：

- 父进程和工作进程都等待在 `do_epoll_wait`；
- 到 Google 地址的 TCP 连接显示 `ESTAB`；
- 只发送少量 TLS 请求，没有收到应用数据；
- `.next` 长时间不再变化。

结合当前 PID 检查 socket，并在源码中搜索：

```sh
ss -tinp
rg -n "next/font/google|fonts\\.googleapis|fonts\\.gstatic" \
  ui/litellm-dashboard --glob '!node_modules/**' --glob '!.next/**'
```

优先消除构建期外网依赖，例如使用仓库内本地字体或系统字体栈。若源码修复属于当前授权范围，修改后
重新执行相关 ESLint、测试和完整 Next.js 生产构建；否则保留现场并报告建议。

## 安全停止容器替换前的构建

只有部署或恢复动作已获明确授权，并且同时满足以下条件，才考虑停止卡住的部署：

1. 部署仍处于构建阶段。
2. 旧 `litellm-prod` 容器仍健康。
3. 新容器尚未启动，没有迁移或数据库事务。
4. 已确认部署进程的精确 PID 和进程组。

先检查：

```sh
ps -o pid,ppid,pgid,sid,state,command -p <已确认的 PID 列表>
```

仅向已确认的部署进程组发送 `TERM`，随后验证所有相关进程退出且旧容器仍健康。禁止使用宽泛 `pkill`、猜测 PID、递归清理或删除未知目标。

## 生产容器已经缺失

若 `docker container inspect litellm-prod` 已确认容器不存在：

1. 确认没有另一个部署进程、临时容器或数据库迁移仍在运行。
2. 继续使用经现场确认的标准部署入口；部署脚本应在镜像校验和数据库只读预检通过后，
   把“容器不存在”视为“无需停止”，直接启动新容器。
3. 如果脚本因旧容器不存在而退出，先确认脚本修改属于当前授权范围；若是，修正停止函数，使缺失
   分支直接返回成功，并用 `sh -n` 验证语法后重新运行标准部署；若不是，停止并请求授权。

禁止创建同名占位或假容器来通过存在性检查，也不要在标准部署脚本之外手工拼接 `docker run`。
前者会掩盖部署脚本的灾难恢复缺陷，后者容易造成环境变量、挂载、端口或重启策略漂移。

## 迁移或健康检查超时

新容器仍运行但尚未监听时：

1. 检查 `docker ps -a` 和 `docker inspect` 中的运行、OOM、重启和健康状态。
2. 读取有限范围容器日志，不打印环境变量。
3. 若迁移状态不明确，从容器内检查 `pg_stat_activity`。
4. 只要迁移 SQL 仍活跃、容器仍运行且未 OOM，即使 Docker 标记为 `unhealthy` 或部署命令超时，也继续等待。
5. 迁移提交后，再等待容器恢复健康并继续上线核验。

禁止删除或重启仍有活动迁移事务的容器。

## Samba 共享依赖的平台错配

仓库由 macOS 和 Linux 通过 Samba 共享。远程 `npm ci` 可能把 Linux 原生可选依赖写入共享 `node_modules`，导致本地 macOS Vitest、Rollup 或可执行入口报错。

本机测试收集、TypeScript 扫描或构建因 Samba 小文件 I/O 明显变慢，或者出现原生依赖平台错配时，
不要在本机反复重试或安装另一平台的依赖作为补丁。优先在挂载同一 checkout 的 `cc-server-dc` 中
完成测试、ESLint、类型检查和构建；源码会通过 Samba 自动同步，不执行 `scp` 或 `rsync`。

执行前按以下顺序确认现场：

1. 确认当前可用的实际 SSH 主机入口。交互中的 `sshjl3` 可能只是称呼而不是本机可解析的 SSH alias；
   alias 解析失败不代表远端不可用，应回到“已知拓扑与事实源”核实当前主机，不尝试猜测多个地址。
2. 用只读检查确认 `cc-server-dc` 正在运行、仍挂载目标仓库，并在容器内确认仓库路径。
3. 从对应目录的当前 `package.json` 读取脚本，再用已确认的值执行：

   ```sh
   ssh <已确认主机> 'docker exec -w <已确认仓库目录> cc-server-dc sh -lc "<验证命令>"'
   ```

4. 前后端目录不同，分别设置 `docker exec -w`；先跑聚焦检查，风险需要时再扩展到 production build。

先判断错误是否来自平台依赖、命令参数还是业务代码。不要为此删除共享 `node_modules` 或锁文件，也不
要让本机与远端同时安装依赖或写入同一个构建缓存。独立门禁命中既有基线问题时，明确区分本次回归、
已知基线和未验证项。

## 脏工作区和并发 Git 活动

默认认为无关修改和已暂存内容属于用户或其他任务：

- 只执行只读检查。
- 未获单独授权时，不执行重置、恢复、清理、暂存或提交。
- Git index 暂时繁忙或读取失败时，不修复或覆盖 index；稍后重试只读检查并确认是否为并发活动。
- 部署前确认目标修改已通过 Samba 出现在远端工作区。
