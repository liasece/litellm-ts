# 部署故障诊断参考

## 目录

- 构建疑似卡住
- Next.js 外部字体死锁
- 安全停止容器替换前的构建
- 迁移或健康检查超时
- Samba 共享依赖的平台错配
- 脏工作区和并发 Git 活动

## 构建疑似卡住

保留当前部署会话，在另一个只读 SSH 会话中检查：

```sh
pgrep -af "restart-litellm|npm run build|next build"
ps -o pid,ppid,pgid,sid,etime,state,%cpu,%mem,command -p <已确认的 PID 列表>
docker ps --filter name=litellm-prod --format "{{.Names}} {{.Status}}"
```

从当前 `AGENTS.md` 确认远程仓库路径，再检查构建目录最近是否仍有文件写入。不要直接照抄历史路径。

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

优先消除构建期外网依赖，例如使用仓库内本地字体或系统字体栈。修改后重新执行相关 ESLint、测试和完整 Next.js 生产构建。

## 安全停止容器替换前的构建

只有同时满足以下条件，才考虑停止卡住的部署：

1. 部署仍处于构建阶段。
2. 旧 `litellm-prod` 容器仍健康。
3. 新容器尚未启动，没有迁移或数据库事务。
4. 已确认部署进程的精确 PID 和进程组。

先检查：

```sh
ps -o pid,ppid,pgid,sid,state,command -p <已确认的 PID 列表>
```

仅向已确认的部署进程组发送 `TERM`，随后验证所有相关进程退出且旧容器仍健康。禁止使用宽泛 `pkill`、猜测 PID、递归清理或删除未知目标。

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

先判断错误是否来自平台依赖，而不是业务代码。部署任务中不要为此删除 `node_modules` 或锁文件；在远程 Linux 主机设置 `AGENTS.md` 当前给出的 Node.js `PATH` 后运行聚焦测试和 ESLint。避免本地与远程同时安装依赖。

## 脏工作区和并发 Git 活动

默认认为无关修改和已暂存内容属于用户或其他任务：

- 只执行只读检查。
- 未获单独授权时，不执行重置、恢复、清理、暂存或提交。
- Git index 暂时繁忙或读取失败时，不修复或覆盖 index；稍后重试只读检查并确认是否为并发活动。
- 部署前确认目标修改已通过 Samba 出现在远端工作区。
