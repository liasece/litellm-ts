# Dashboard Vue 重写方案与验收记录

当前状态：Vue 实现已接入标准源码目录 `ui/litellm-dashboard`，尚在最终产物与逐页截图验收。生产仍运行 React，未部署、未提交或 push。

## 可行性与边界

采用观澜的 Web 工程栈可行。原界面主要由浏览器端组件、HTTP API 和静态导出组成；迁移不要求改变数据库、计费、供应商协议或托管 CLIProxy 运行时。主要成本在 AntD/Tremor 的视觉与交互复现、Recharts 到 ECharts 的几何对齐，以及大量表单、流和弹窗的生命周期。

初始源码为 `8bc9a1d6af65`，35 个 Next 页面入口与 32 个 legacy query-page 分支存在重叠，不能相加统计。所有可达路径、legacy `?page=...`、公共页面、角色与配置门禁都在迁移范围内。侧栏未显示的页面仍需验收。

目标版本按观澜锁文件核实：Vue/compiler 3.4.21、Vite 8.3.5/plugin 6.0.10、TypeScript 5.9.3、Vue Router 4.4.4、ECharts 6.1/vue-echarts 8.1、Vitest 4.1.12、Playwright 1.55.1、ESLint 8.57 与 Prettier 3.6。当前精确版本以 package.json/锁文件为事实源。

使用原生响应式 Store 和普通 CSS，按功能划分 API、data、logic、stores、render、ui。保留原设计、字体、图标、响应式规则和所有文案；复用的资源与算法随构建分发许可证。当前入口不导入 React、Next 或另一套视觉设计。

## 重写与发布步骤

1. 保留旧源码、对照产物来源和每轮原始截图，冻结合成数据前置基线。
2. 实现共享控件、导航、会话、Worker、价格展示、返回地址与访问控制。
3. 逐功能迁移 Keys、Models、Logs、Usage、CLIProxy、设置、访问管理、Playground、Hub、工具、策略、Prompts 等所有入口。
4. 对齐请求方法、路径、DTO、CSRF、虚拟密钥推理认证、分页/筛选、取消、流、下载、弹窗与图表交互；区分后端原有能力缺口。
5. 绑定源码指纹进行生产构建，重拍桌面与手机交互状态，保留逐像素原始差异，收敛可重复问题。
6. 接入 canonical 构建目录和后端静态路由，验证深链、前缀、CSP、资源 404、旧客户端缓存资源和回退边界。
7. 全部门禁完成后，使用标准 deploy-litellm-ts 流程发布，并核验真实线上页面、接口、资源与本次变更的可观察行为。

源码迁移、功能回归与第 6 步的静态路由接入均已完成，并于 2026-11-08 按第 7 步完成生产发布和线上核验。视觉验收按用户后来放宽的目标执行：不再要求逐像素一致，以功能一致、无可见显示缺陷为准，剩余像素差异逐项归类为缺陷或噪声，见 `.artifacts/frontend-vue/acceptance/vue-candidate-measurement-2026-11-08-v4.json`。

## 认证和资源生命周期

保持 HttpOnly session cookie、写请求 CSRF、显式虚拟密钥推理的独立认证、六小时 keepalive、Worker 切换、登录返回 URL、取消旧请求、清理订阅/图表/流。不改变持久化或账单计算。

保留原页面装配差异：旧 legacy 根页的 YAML 配置差异弹窗和 Claude Code nudge 仅在根页装配；路径式 dashboard 的 Debug 模式警告仅在路径式页面显示。UsageIndicator、浏览器偏好与其原事件名按原契约工作。

Guardrails、Policies 等旧页面对若干当前后端并未实现的接口仍有依赖。合成浏览器用例只证明前端请求与状态契约，不能证明线上存在这些后端能力；迁移不借机扩展后端功能。

## 截图和证据

证据根目录为 `.artifacts/frontend-vue`，保留在工作区且不进入镜像。原始截图、HTML、请求/错误记录、导出文件和 SHA 锁均不覆盖。

使用 JL3 开发容器 Chromium 1208、1440×1000 与 390×844、DPR 1、en-US、Asia/Shanghai、light、合成数据。交互时钟从固定时间推进，截图前冻结。严禁真实凭据或业务秘密出现在证据中。

基线包括 default 82、Keys 58、Models 54、Logs 42、Usage 72、Cost 46、Builtin 16、Speed 14、Shell 22，以及各专属 runner 中的身份、访问管理、工具、设置、Guardrails、Prompts、Hub、Playground 等状态。数量会随明确补充的场景增加，不以截图数量代替验收质量。

首轮 default fixture 中 Users、Tags、Builtin、Speed 与真实 DTO 不符，已另行校准并保留早期诊断；存在定位失败的旧运行也保留，不能作为成功基线。冻结脚本验证原图、清单与输入脚本 SHA，旧脚本重排/目录切换前逐字存档到 source-inputs。

每个正式 after 必须来自同一个完整生产构建，并记录 build-provenance。`source-*`、`diagnostics` 和 Vite dev 截图只用于定位，不是生产验收。

公开比较器保留完整 RGBA 差异，没有遮罩或统一容差。实际截图成功、交互通过、像素一致和用户批准的例外分别记录。旧版测量缓存或 popup 定位波动有重复观测；不覆盖原图，也不为追单张截图加入时序补丁。

## 明确批准与其他差异

用户于 2026-11-07 明确批准 SSO 帮助提示定位修复 `sso-disabled-help-placement`，随后批准 Policies 删除附件正常确认框 `policy-attachment-confirm-rendering`。原图、差异和真实操作证据均保留。

用户进一步给出持续决定：“保留。同类不用问我”。适用范围仅为经过实际复现并保留前后截图、成因和行为核验的三类旧缺陷：菜单/提示被定位到视口外；静态确认框没有渲染；Select 首次方向键没有阻止浏览器默认滚动。同一静态渲染故障还已实际记录 YAML 原 catch 的 message.error 被调用但没有 holder/DOM；新版恢复原错误反馈逐项归档，不新增业务反馈。每项仍须登记 id、范围与证据；不豁免一般布局、未知图像差异或其他业务/权限改变。批准策略位于 `.artifacts/frontend-vue/acceptance/approved-exception-policy-v1.json`，单项对照入口为 `.artifacts/frontend-vue/reviews/old-defects-v1/index.html`。旧图和严格 RGBA 报告不随批准而改写。

模型映射的两个原帮助层已实测被父 table 的滚动可见区裁切，手机端还伸出视口；原帮助正文、触发器几何与完整截图均保留。此类浮层恢复可见性按上述同类授权逐项登记于 acceptance/models-mapping-help-clipping-source-v1.json，不豁免表头、文案或普通间距差异；正式新产物证据仍须补齐。

非视觉正确性修正单列：Models 批量创建按每个映射独立换算一次 per-million 价格；Usage 模型导出使用各模型的 key breakdown；Hub 发布失败显示 HTTP 失败。后续模型回退保存恢复原版逐键合并规则，保留同一条记录中其他模型与顺序；旧请求完成不能关闭后来打开的另一弹窗。Pass-Through 预览恢复实际 API base URL、Worker 与前缀。均有合成契约回归，不改既有配置或业务数据，其可见差异不属于 SSO 例外。

内置能力保存还恢复了旧 Form 的字段投影：不把只读响应中的 handler_model 和页面不可编辑的 web.always_inject 当成用户修改提交。4 个真实 PUT 合成场景的完整请求及后端归一化结果已与旧版逐字段相等；原 echo fixture 缺省字段不符合实际 canonical 响应，因此另行冻结同一真实纯 normalizer 响应的前置基线，原图和 fixture 不覆盖。

## 构建、静态托管与回退

`ui/litellm-dashboard` 现为 Vue；旧源码、依赖和当时的 React out 原位重命名至 `ui/litellm-dashboard-react-reference`，保留为只读对照并从 Git/镜像输入排除。目录切换记录位于 integration/CanonicalCutover-v1.json。没有复制共享源码、修改外部发布脚本或改变生产。

对照产物溯源单列：初期 identity-before 的 index.html SHA 为 fd7c6611…；当前 React reference 的 out/index.html 与 .next/server/app/index.html 均为 83b0afe4…，mtime 为 04:18Z；已只读核实实际生产 /app/ui/out/index.html 与此 SHA 完全相同，记录于 production-before-vue-20261107-v1/deployed-public-artifact.json。这一早期完整 Next 重构建的执行者/原因未从现存上下文确定，不能声称两次产物完全不变。已逐字核验 1481 个 tracked 旧前端源文件，相对 8bc9a1d6 只有 AGENTS.md 不同，运行源码、配置和锁文件相同。独立旧版重放保留新目录、来源和对原截图的差异，不覆盖或伪造初始基线。

标准发布入口继续构建原 canonical 目录。BuildRuntime 先保存上一发布 `ui/out` 的 `_next`、RSC `.txt` 和 manifest 引用的 Vite 资源，并通过 retained-client-assets 清单跨版本保留；完整镜像构建可从上次 package out 取兼容资源。不存在先前产物时允许全新安装。文件名冲突而字节不同、越界路径或 symlink 会阻止构建。此逻辑有实际临时目录的行为测试。

构建前后源码指纹必须一致，分发源资源和依赖许可证。后端优先识别有效 Vite manifest，在已知页面路由返回 Vue HTML；初始相对 base 与阻塞的 ui-base.js 支持深链和挂载前缀，SPA history 使用根路由。HTML/bootstrap no-store；只有当前 manifest 指纹资源使用 immutable。保留旧 `_next`/RSC 地址，缺失资源仍返回 404。

真实 Express 路由测试覆盖 GET/HEAD、混合产物、深度/尾斜线和缺失资源；prefix/CSP 浏览器 smoke 覆盖根、/tenant、/gateway/litellm 的入口、导航和回调。它证明前端挂载契约，不声称后端 discovery 已支持任意部署前缀。

回退保留原 React 产物和标准发布的上一镜像；生产切换前继续使用原版。切换后若需回退，沿标准运维流程恢复上一已验证镜像，不改数据库/CPA 版本或插件。

## 当前门禁

按“只守住可观察行为、业务契约和重要分支”的标准清理过一轮前端单元测试：移除了对照旧图表像素坐标的断言、只复述格式化函数和静态配色表的用例，以及对照冻结 HTML 的快照用例；清理后为 120 文件/486 项，TypeScript、ESLint、Prettier 与 Vite production build 均通过。判断依据与逐文件取舍见 `.artifacts/frontend-vue/acceptance/vue-candidate-measurement-2026-11-08-v4.json` 的 testReview 段。

候选 30e760c80ff3 的 Vue 全量 Vitest 为 118 文件/494 项通过，整包 ESLint、TypeScript、格式和 Vite production build 通过；1293 个正式场景已完成采集且无页面/捕获错误，路径前缀与 CSP 12 项通过。严格图像比较仍发现普通显示回归，因此该产物明确登记为 failed-visual-checkpoint，不能据此部署或宣称验收通过。

构建 `c491680a4e9274bb` 复拍全部 16 个产品套件 474 张：采集与原始比较完成，`out` 前后字节树一致；严格 RGBA 仅 18 张相等于基线，合计差异 11,405,509 像素（access 68/2/900,651、guardrails 82/2/2,510,326、mcp 62/0/1,976,568、prompts 60/0/2,448,831、tools 60/1/1,267,963、monitor-policies 24/0/710,526、access-fixes 14/0/524,068、mcp-monitor-fixes 10/0/369,677、owned-fixes 18/1/359,792、tools-fixes 12/0/100,329、mcp-review 4/0/84,332、identity 22/6/62,040、usage-indicator 28/4/42,934、debug-warning 6/0/28,351、users-calibrated 2/0/19,121、tags-calibrated 2/2/0）。逐项量化见 `.artifacts/frontend-vue/acceptance/vue-candidate-measurement-2026-11-08-v1.json`。

构建 `d4d798d15f51ad48` 复拍同一批 474 张，合计差异降到 10,070,816 像素（-11.7%，严格相等 19 张）：mcp 1,976,568→1,316,535、mcp-monitor-fixes 369,677→46,737、guardrails 2,510,326→2,169,934、mcp-review 84,332→78,139。三处共用组件根因已按旧版实测值改齐并复核：Tremor Tab 行高由活动 Tab 的 2px 指示条决定（行高 36.41px、其余 Tab 拉伸对齐，标签 y 在四个页面均与旧版相同）；guardrail 内容分类单元格恢复两行结构（td 61px、子行 22px、y 逐像素相同）；提交详情面板徽标行 4px、提交信息与字段标签 12px/16px、端点行 16px 且 grid 子项 min-width:0（h2 193.41、描述 251.41、端点 311.41 与旧版一致）。顶栏用户按钮也由 14px/21px 改为 AntD 的 14px/22px。逐项量化见 `.artifacts/frontend-vue/acceptance/vue-candidate-measurement-2026-11-08-v2.json`。

用 DOM 墨迹框对比替代肉眼比图后，剩余差异以共享组件的亚像素偏差为主：MCP 列表页 React 未选中 Tab 无边框、行高由内容 20.41px+16px 决定，选中 Tab 才有 2px 下边框并被拉伸；Vue 早期版本给所有 Tab 固定 2px 透明边框，含 New 徽标的 Tab 因此 38px，把整行列表和下方表格分别推低 0.8px 与 1.59px（该根因已在上述构建中改齐）。389/474 张的差异落在 1–60k 区间，多属此类 0.5–2px 的行高、内边距与边框归属差异，不是文案、权限或交互改变。Prompts 390 的 `prompt-tool-added` 曾在旧构建中显示与基线不同的面板，单独重拍复核后不再重现：两侧都是同一个编辑表单，剩余 31,596 像素（9.6%）只是亚像素位移，因此按噪声记录而不是缺陷。

随后修复的是实际旧结构：卡片内部内容容器、移动表单样式顺序与列宽、模型弹窗 520px/Save/原帮助文案、主 Tabs 分组、原滚动容器、表单控制区 min-height、按原字体继承的副标题、透明 Drawer 阴影宿主与白色内容层。原图、原始差异、每次编辑前字节/SHA 均保留。这些变化是普通回归修复，不登记为用户豁免。新源码还有必要门禁和同一新产物的完整重拍待执行；source/diagnostics 只能用于定位。

排行图另恢复原 SVG viewBox 到实际小数像素容器的等比缩放语义，绘制、annotation 和 cursor 共用变换，HTML legend 与 portal tooltip 保持独立；桌面两块完整排行图区域源诊断已严格 0 像素差异。真实指针核对还恢复了旧版 Daily/ranking 柱体悬停不变色的契约。用量视图选中值的原行内图标包装也已恢复，图标和完整选中值行源诊断均严格 0 差异。原始失败与后来撤回的诊断判断均留在报告中。

抽屉阴影的独立受控实验已追到 native dialog/backdrop 绘制组合：236 个原可见节点和 44 项绘制属性保持相等时，普通 DOM 对照消除了 29595 处背景差异，633 处前景差异没有变化。保留原生模态、滚动裁切和几何时，内部 viewport mask 与等几何阴影层的组合实验也取得同样结果；单独更换 mask 或转交 shadow 均未改善。正将这个有行为证据的最小绘制方案落源，不以调 alpha、放宽滚动或一般像素容差代替修复。实验索引为 diagnostics/prompt-native-preserved-mask-2026-11-07T14-55-v1/Conclusion-ABC-v1.json。

后端完整 Jest 已通过：144 个套件、1915 项测试，另有基线跳过 4 个套件/31 项；TypeScript、ESLint 与 production build 已通过。生产迁移前登录页的 1440/390 两宽截图已单独保存在 `.artifacts/frontend-vue/production-before-vue-20261107-v1/`，来自真实生产页面，未拦截 API 或伪造登录身份。

Old Usage Activity 的 Recharts 字体过渡/测量缓存会让日期刻度密度受先前图表影响。实测记录在 `.artifacts/frontend-vue/scope-review/LegacyActivityTextMeasurementReview-v1.json`：该行为在参考实现里本身就是不确定的，取决于此前图表渲染留下的状态，无法作为稳定的对齐目标。决定不在 Vue 侧复刻，改用确定性测量；刻度标签保持可读，记为有意保留的非一致性而不是缺陷。

浏览器侧的 visual-baseline 采集与比对脚本（`ui/litellm-dashboard/e2e/`）只能在带 `.artifacts` 证据和 React 参考构建的工作区使用，已按用户要求从仓库移除；组件级浏览器回归仍由 `tests/platform-ui` 配合 `test:components` 保留。生产候选的构建指纹、门禁结果与线上核验记录见上述验收文件。2026-11-08，用户要求确认应跟踪的文件后提交。Vue 仪表盘迁移已在 `13adcfb` 提交，后续维护按当前任务授权执行。
