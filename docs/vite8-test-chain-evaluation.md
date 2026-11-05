# Dashboard Vite 8 测试链评估

评估日期：2026-11-04（Asia/Shanghai）。

本轮保留 Vite 7.3.1 / Vitest 3.2.4。候选 Vite 8.3.5 / Vitest 4.1.10 的定向兼容检查通过，但普通测试只观察到约 0.25 秒的差异，watch 没有改善，收益不足以支持本轮为测试反馈提速进行 Vitest 大版本迁移。测试依赖、锁文件、配置和临时调整的 7 个测试文件均已恢复原内容，最终只新增本报告与[测量摘要](vite8-test-chain-results.json)。

Dashboard 页面开发与生产构建使用 Next.js 16.1.7，React 保持 18.3.1；Vite 服务于 Vitest。这里的测量只涉及前端测试反馈，不代表 Next.js production build、页面 HMR 或应用运行速度的改善。后端 TypeScript、Jest 和业务架构均未调整。

## 对照结果

固定 8 个文件、111 项测试，两个版本各启动新进程运行三轮，均使用 4 个 worker。测量包括工具启动、转换、模块加载、jsdom、测试、报告和进程退出，排除安装、网络下载、Lint、TypeScript 和 Next 构建。

| 检查 | 原测试链 | 候选测试链 |
| --- | ---: | ---: |
| 三轮墙钟中位数 | 10.235 秒 | 9.985 秒 |
| 三轮范围 | 10.085～10.385 秒 | 9.935～10.133 秒 |
| 同一 111 项测试 | 全部通过 | 全部通过 |
| 加覆盖率，单次墙钟 | 23.716 秒 | 21.509 秒 |
| watch 依赖变更重跑，单次 | 0.808 秒 | 0.847 秒 |

普通测试观察差异为 2.443%，绝对差约 0.250 秒。样本较少，区间有重叠；版本按“原版三轮→候选三轮”顺序运行，未交替安装或隔离其他主机任务。因此不宣称稳定的百分比收益；本次固定 4 个 worker，也没有测量默认并行度下的表现。覆盖率与 watch 各只有一个样本，不能据此作稳定提速或退化结论。

Vitest 报告的部分累计计数如下。它们涉及并行文件、存在交叠，不能直接相加或从墙钟相减；旧版 collect 与新版 import 也不作为完全相同的阶段比较。

| 报告计数，三轮中位数 | 原测试链 | 候选测试链 |
| --- | ---: | ---: |
| transform | 0.875 秒 | 0.703 秒 |
| setup | 0.985 秒 | 0.997 秒 |
| tests | 10.920 秒 | 10.930 秒 |
| environment | 3.730 秒 | 3.750 秒 |

转换的确较短，但 React/Ant Design 交互、模块加载和 jsdom 仍承担主要成本。原链全量基线为 412 个文件、3,920 项测试全部通过，墙钟 446.145 秒；其中一个模型详情文件的测试执行约 110 秒。这些信息支持把日常反馈优化继续放在实际测试工作量上，而不是套用其他项目的 Vite 构建倍数。

## 样本和源码条件

代表集覆盖价格规则、TanStack Query、日志文本与图片、费用估算计时器、SDK 流式请求，以及复杂表格和模型别名编辑：

- src/utils/priceDisplay.test.ts
- src/app/(dashboard)/hooks/models/useModels.test.ts
- src/components/view_logs/LogDetailsDrawer/SessionSimulationDrawer.test.tsx
- src/components/view_logs/LogDetailsDrawer/MessagePartsView.test.tsx
- src/components/CostTrackingSettings/pricing_calculator/use_multi_cost_estimate.test.ts
- src/components/playground/llm_calls/responses_api.test.tsx
- src/components/VirtualKeysPage/VirtualKeysTable.test.tsx
- src/components/model_group_alias_settings.ui.test.tsx

所有源码读取、编辑、Git、安装和验证都经 SSH 在已有 cc-server-dc 的同一 checkout 中进行。已核对父目录 /root/var/src/jtllab 的真实挂载；没有复制源码或创建替代开发容器。本机 Samba 路径只作为项目入口。

容器为 Linux x64，Node 24.22.2、npm 11.19.1、AMD EPYC 7763；容器 CPU 配额相当于 80 核、内存上限 128 GiB，测试固定 4 个 worker，主机同时有其他任务。测试数据在初始 SSH 故障恢复、重新核对环境以后采集；本会话没有执行主机电源操作。

原工作树有大量协议、费用、日志和会话时间线改动。本次记录了 1,304 个 Dashboard/共享源文件的摘要。原全量基线先运行；随后仅把 7 个 SDK 构造器 mock 改为可构造的普通函数，并在旧版 Vitest 上通过 11 个 SDK 文件、27 项测试。新旧版本的三轮代表集和 coverage 均使用这份相同源码，111 项用例身份及结果摘要一致。恢复后全部 1,304 个文件与原摘要一致，包、锁文件、配置按原字节恢复。

## 候选选择与迁移语义

[Vitest 4.1.10 官方包信息](https://registry.npmjs.org/vitest/4.1.10)允许 Vite 8，兼容现有 Node 与 @types/node 20.19.37；[Vite 8.3.5 官方包信息](https://registry.npmjs.org/vite/8.3.5)的 Node 下限在此环境满足。选择 4.1.10 是为了采用支持 Vite 8 的较小迁移组合，并让 UI、coverage 与 Vitest 保持相同版本。

[Vitest 5 迁移说明](https://vitest.dev/guide/migration/)还引入默认 clearMocks、嵌套 hoisted mock 限制、测试全名匹配和 UI 认证等变化，[5.1.0 官方包信息](https://registry.npmjs.org/vitest/5.1.0)也要求更高的 Node 类型版本。本轮没有把这些额外变化纳入候选。

实际核对内容：

- 按 [Vite 8 迁移说明](https://vite.dev/guide/migration.html)，把 esbuild 的 automatic React JSX 设置改成 oxc.jsx 的 runtime/importSource，保留 React 18、jsdom、全局 API、CSS、setup、20 秒超时、测试选择和 coverage include/exclude。
- 按 [Vitest 4 迁移说明](https://v4.vitest.dev/guide/migration.html)，让被 new 调用的 OpenAI/Anthropic mock 使用普通函数。7 个文件只改变 mock 实现形式，断言未改动；相关结果保留在摘要中。这些调整已撤回。
- 保留既有 cleanup、局部 clear/reset/restore 和 fake timers 用法，没有新增自动清理配置来掩盖失败。定向样本覆盖这些用法及模块 factory；候选未执行完整套件，不能扩大为所有 mock 行为均已验收。
- 配置已经显式指定 src/tests 的测试模式，未发现 .snap、toMatchSnapshot 或 toMatchInlineSnapshot。样本中新旧版的 111 项用例选择与结果一致，未 skip、延长超时或弱化断言。
- watch 实测是在价格规则依赖文件上触发文件变更通知，观察同一 4 项测试自动重跑；文件内容保持不变，结束后恢复原 mtime。
- 候选 UI 以 loopback 临时端口启动，由真实 Chromium 打开，返回 HTTP 200，文件和测试分组可见，页面错误为 0。服务及浏览器随后退出。

这些是定向兼容证据。因为实测收益不足，本轮在候选全量验收之前结束实验，没有执行候选的 412 文件全量测试、全量 ESLint、独立 TypeScript 或 Next production build。

## 覆盖率与依赖联动成本

两个版本均生成 text、lcov 和 json-summary。现有显式 include 保留了未执行源文件，两个报告的源文件集合完全相同，均为 876 个。

下面是 8 文件定向运行的报告计数，用来核对统计口径，不代表完整测试套件的覆盖率：

| 统计项 | 原测试链 | 候选测试链 |
| --- | ---: | ---: |
| 报告文件数 | 876 | 876 |
| lines.total | 131,679 | 35,861 |
| functions.total | 1,336 | 9,461 |
| branches.total | 1,613 | 31,473 |

原 Vitest 3.2.4 已使用 ast-v8-to-istanbul；候选又更新映射实现并更换转换链，因此行、函数和分支计数仍明显变化。不能把覆盖百分比的变化当作业务测试覆盖突然变化。正式维护 Vitest 时需要审查并重新解释这些报告；现有配置没有覆盖率阈值，本次也未增加或调低阈值。

正常严格安装同时把 Dashboard 直接使用的 PostCSS 从 8.5.6 提升到 8.5.32：Vite 8.3.5 要求 PostCSS ^8.5.30，npm 将它提升到了根依赖位置。Next 和 React 版本保持不变，但这已牵涉 Next/Tailwind 的生产 CSS 输入。候选测量包含这项依赖图变化，不能把全部差异归因于 Oxc。正式升级时应审查依赖布局与生产 CSS 行为。本轮已恢复 PostCSS 8.5.6，未留下额外 pin、override 或忽略 peer 的设置。

## 最终验证与交付边界

恢复原依赖后，以下检查全部通过：

| 检查 | 结果 |
| --- | --- |
| npm ci | 成功；所有直接安装版本与原锁文件一致 |
| 代表集复验 | 8 文件、111 项全部通过 |
| npm run lint | 通过 |
| npx tsc --noEmit | 通过 |
| npm run build | Next.js production build 通过 |
| git diff --check | 通过 |
| 工作区保护 | 原包/锁/配置和 1,304 个源文件摘要恢复；既有 staged/unstaged/untracked 状态保留 |

复现时，在同一容器的 ui/litellm-dashboard 目录使用现有脚本，保持 worker 与文件参数一致。八文件采样的实际命令保存在摘要的 selected_run_command；重新采样时选择新的报告输出路径。常规检查命令为：

    npm test -- --run --maxWorkers=4
    npm run lint
    npx tsc --noEmit
    npm run build

实际采样使用 default/json reporter 保存结果，并用父进程单调时钟记录墙钟；原始时长、用例摘要、负载、版本和源码指纹保存在[测量摘要](vite8-test-chain-results.json)。三轮普通测试不含覆盖率。coverage 临时输出、详细日志、实验脚本、任务快照和本次 UI/watch 服务在交付时清理。

依据公司 [codex-delegate Skill](/Users/jansen/.codex/skills/codex-delegate/SKILL.md)发起只读 MiniMax 委派“委派 · jansen · LiteLLM：核对 Vite 8 与 Vitest 迁移风险”；480 秒超时并确认中断，没有把其未完成结果作为验收依据。迁移结论来自本会话对官方资料、源码和运行结果的核对。

本轮只交付评估记录，未采用候选工具链，没有实际应用行为变更，因此没有生产部署、线上业务核验、提交或 push。将来以 Vitest 维护为目标升级时，可复用本次构造器 mock 与覆盖率迁移清单。
