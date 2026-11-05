# LiteLLM TS 仓库协作约定

## 适用范围与事实源

- 本文件只保存每次仓库任务都需要的稳定边界。具体实现、命令和版本以当前源码、`package.json`、
  锁文件及实际脚本为准，不在这里维护日期化测试数量、工具链补丁版本或生产现场快照。
- 修改 `ui/litellm-dashboard/` 前，完整读取该目录的 `AGENTS.md`；更近目录的规则只覆盖其作用域。
- 上游近期变更评估与对齐状态维护在 [docs/upstream-alignment.md](docs/upstream-alignment.md)；执行类似调查或复刻前先读该记录，按源码与验证结果更新状态。
- 生产部署、线上核验和故障恢复使用 `$deploy-litellm-ts`。生产拓扑与诊断信号只在该 Skill 的
  reference 中维护，不复制到根指令。

## 托管 CLIProxy（CPA）运行时

- 本仓库自带 CLIProxyAPI：`src/cliproxy/CliProxyRuntimeManager.ts` 在应用容器内以子进程启动
  `cli-proxy-api`，配置、凭证、日志和版本都放在 `CLIPROXY_RUNTIME_ROOT`（默认
  `/var/lib/litellm/cliproxy`）下。它不是外部独立服务；排查 CPA 或改 CPA 配置先看这里，
  不要假设另有一套独立部署的 CPA。
- 运行时镜像由 `Dockerfile` / `Dockerfile.runtime` 构建，**runtime 阶段必须是 glibc 发行版**
  （当前为 `node:22-bookworm-slim`）。官方 CPA 插件版二进制和插件 `.so` 都动态链接 glibc，
  Alpine/musl 无法加载（gcompat 兼容层实测会崩溃）；不要为了缩小镜像把 runtime 改回 Alpine。
  Alpine 只能用于构建阶段。
- CPA 发布物分两种：`_no-plugin` 静态构建（任意 libc 都能跑）和插件版（依赖 glibc）。
  管理器的选择规则是 ≥ 8.0.0 使用插件版，< 8.0.0 继续用 `_no-plugin`。构建参数
  `CLIPROXY_VERSION` 只决定新实例的 bootstrap；已有实例的 `current` 软链不会因镜像升级
  自动切换，需要在 CLIProxy 页面升级版本后插件才会生效。
- 插件配置由管理器投影进 `config.yaml` 的 `plugins` 块，仅当当前 CPA ≥ 8.0.0 且插件文件存在时
  注入。`plugins.enabled` / `plugins.dir` 属于托管边界，用户配置中同一插件 id 的其他字段优先。
  插件目录由 `CLIPROXY_PLUGIN_DIR` 指定；OpenCode Go 的密钥优先通过 `OPENCODE_GO_API_KEY`
  环境变量注入，不要把密钥写进仓库、配置样例或日志。
- CommandCode GOAT/Pro/Max 插件（`commandcode-go-cliproxyapi`）同样内置。它不接受插件配置里的
  `api-keys`；账户写在 LiteLLM 配置的 `plugins.managed-accounts.commandcode`（单对象或数组），
  管理器把每个密钥投影成 `CLIPROXY_RUNTIME_ROOT/auths/` 下的托管 auth 文件（手写 auth 文件仍兼容）。
  Dashboard 的 OAuth accounts 页签支持增删改托管账号。模型前缀为 `commandcode/`，额度走插件的
  `quota-usage` 管理接口。CommandCode Go 套餐不支持。细节见
  `docs/cliproxy-commandcode-goat-plugin.md`。
- 该插件的源码是**本仓库 fork**：`plugins/commandcode-go-cliproxyapi/`。镜像从该目录现场
  编译（`Dockerfile` / `Dockerfile.runtime` 的 `commandcode-plugin-build` 阶段），
  **不再下载上游 release**。上游 0.1.3 对 Responses `namespace` 工具直接报错，fork 已修复且
  行为写在 `FORK.md`；同步上游前先读它，不要直接覆盖该目录。
- 账户额度优先走 CLIProxy 的通用插件额度接口（`/v0/management/quota/providers`、
  `/v0/management/quota/fetch`），provider 专用额度逻辑只保留给 codex/claude/kimi/antigravity/xai。
  插件额度是账号级窗口，不提供按模型的美元余额明细。
- 升级、回滚或重启托管 CLIProxy 前会自动降级并排空在途请求（默认 120 秒上限，可用环境变量 CLIPROXY_DRAIN_TIMEOUT_SECONDS 调整），见 [docs/cliproxy-runtime-upgrade.md](docs/cliproxy-runtime-upgrade.md)。
- 改变 runtime 基础镜像、切换 CPA 大版本或调整插件注入规则属于兼容性/部署形态变化，先说明影响、
  验证方式和回滚边界。实现细节、插件来源与验证步骤见
  [docs/cliproxy-opencode-go-plugin.md](docs/cliproxy-opencode-go-plugin.md)。
- 启动链路不等待 CPA 就绪：`createServiceContainer()` 之后由 `container.warmUp()` 在监听后并行
  预热远端模型价格快照与子进程，只有数据库迁移、遗留在途请求回收、路由装配在关键路径上。改动启动
  顺序前先读 [docs/startup.md](docs/startup.md)，不要把 `await cliProxyRuntime.initialize()` 或远端
  价格快照拉取加回装配流程。

## 工作判断

以 API 调用方、上游供应商、Proxy、费用与日志、Dashboard、数据库和运维的完整可观察结果判断方案。必要约束由类型、数据库或检查保证；不能用局部代码更短把兼容、迁移或恢复成本转给其他人。低风险任务无需形式化问卷，公共协议、费用、持久化和生产变更应说明影响、验证与恢复边界。

## 授权与安全边界

- 回答、解释、审查、规划或诊断请求只授权调查和报告，不授权修改代码或改变外部状态。
- 用户对 LiteLLM TS 问题修复给予持续部署授权：修复完成并通过与风险相称的必要验证后，应及时使用
  `$deploy-litellm-ts` 执行标准生产部署及本次问题的线上核验，不因缺少本轮重复部署指令而停在本地。
  此授权适用于该 Skill 的部署变更模式；用户明确要求只改代码、暂不部署或限定环境时，遵循当次限制。
- 功能实现、调整与修复默认包含生产部署：门禁通过后直接完成标准发布与线上核验，见
  “完成定义与部署闭环”。只有用户当轮明确限制（只改代码、暂不部署、限定环境）时才停在本地。
  回答、解释、审查、规划、状态检查和诊断仍只授权只读调查；发现问题不自动授权修复或部署。
- 发布门禁失败或出现超出授权范围的生产数据、基础设施、破坏性恢复等变化时，先诊断并报告具体阻塞，
  不绕过检查。交付时明确区分代码修复、实际部署与线上行为核验的结果；未部署时说明原因。
- `git commit`、push、生产数据写入、基础设施变更和破坏性操作分别需要用户明确授权；一种授权不
  自动包含另一种授权。
- 保留工作区中已有的 staged、unstaged 和 untracked 内容。不要擅自 `reset`、`restore`、`clean`、
  stash、暂存或提交。
- 不得在命令输出、日志摘要、截图、补丁或回复中展示密钥、数据库连接串、认证头或其他凭据。

## 工作区边界

- 本机 /Users/jansen/jl3/src/jtllab/litellm-ts 是 Samba 路径，只用于定位。源码读取、编辑、命令、生成和测试均通过 ssh root@js3.liasece.com -p 22 进入 JL3，再使用现有开发容器 cc-server-dc 的 /root/var/src/jtllab/litellm-ts checkout。不要在本机映射目录执行仓库任务，也不要再次复制源码。
- 首次连接或环境变化时核实开发容器及挂载；容器不存在或挂载不符时报告阻塞，不启动或替换容器。该开发入口不等于生产容器或部署授权。
- 已授权的开发任务可以连接上述开发环境并做相关验证，不需要借用生产运维 Skill；只有生产状态查询或已授权部署才使用 deploy-litellm-ts。
- 平台依赖错配时在开发容器内定位，不为绕过问题删除锁文件、依赖目录或放宽门禁。

## 验证与交付

- 从当前 `package.json` 选择与改动相称的命令。后端常用门禁为 `npm run typecheck`、相关 Jest、
  `npm run build` 和 `npm run lint`；不要把本文列举当成替代当前脚本的第二事实源。
- 修改后至少运行 `git diff --check`，并运行能覆盖受影响行为的最小充分检查。高风险、跨模块或发布前
  改动应扩大到完整相关测试和 production build。
- 前端改动遵守 `ui/litellm-dashboard/AGENTS.md`，至少覆盖相关 ESLint、Vitest、TypeScript 检查和
  Next.js production build；已知基线问题必须与本次回归分开说明，不能用放宽配置绕过。
- 必需检查失败时先诊断根因。若环境阻塞且不在当前授权范围内，保留现场并报告已验证、失败原因和
  未验证项；不得把未解释的失败或未执行的生产核验描述为通过。

## 完成定义与部署闭环

- 功能实现、调整与修复属于默认部署类改动：代码、相关门禁与生产部署构成同一次交付。只有标准部署
  成功、并完成该改动的线上可观察行为核验，任务才算完成；不要停在“本地通过、等待另行授权”。
- 本地或验证容器内的检查通过只是前置条件。单元测试、类型检查、`next build` 成功或压缩产物文本
  都不能替代生产页面、接口或真实日志上的核验。
- 部署入口、门禁范围与核验方式以 `$deploy-litellm-ts` 及其 reference 为准。部署失败时沿具体阶段
  继续定位、修复并复验，不因首次失败或重复确认而提前交付。
- 例外只有两种：用户当轮明确限制部署范围，或发布门禁失败且根因修复超出本次授权。出现例外时必须
  说明已完成的检查、未执行的部署与具体阻塞，不得把未部署或未核验描述为完成。
- 该定义同样约束子代理交付：未部署并核验的功能改动不能报告为已完成。

## 测试质量

- 只新增能够验证可观察行为、业务契约、重要逻辑分支或明确回归风险的测试。
- 不得为了形式上的“修改配测试”而添加仅重复静态配置或实现细节的断言，例如直接读取列定义，
  再断言一个已删除的列名不存在。
- 新增回归测试时，应能说明它在修复前为何失败、在修复后验证了什么真实行为；如果简单的展示配置
  变更没有值得自动化验证的行为，可以只运行现有相关测试、类型检查、构建及必要的页面验证。
- 不以测试数量或覆盖率数字代替测试价值；测试不应因无关重构或文案调整而频繁失败。

## 专用工作流

- 生产检查、部署或部署故障：使用 `$deploy-litellm-ts`，先区分只读诊断与已授权部署。
- 提交已暂存内容：仅在用户明确要求提交时使用 `$commit-staged-changes`；该 Skill 不授权 push 或部署。
