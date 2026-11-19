# LiteLLM Dashboard Vue 前端契约

本目录采用观澜 Web 工程栈：Vue 3、TypeScript、Vite、原生响应式 Store、普通 CSS、ECharts、Vue Router、Vitest、Playwright、ESLint 与 Prettier。具体版本以 package.json 和锁文件为准。

- 本次迁移的范围、截图证据和发布门禁见 ../../docs/frontend-vue-migration.md。保留现有外观、响应式布局、URL、权限、认证和业务交互；验收例外必须有用户明确决定。React 对照源码和产物位于 ../litellm-dashboard-react-reference，只供调查和回退。
- 不在当前运行时引入 React、Next、TanStack Query 或另一套组件设计。现有视觉由本项目 CSS 与 Vue 组件实现；复用的图标、算法和静态资源须保留来源及许可证。
- 按功能与职责组织 API、data、logic、stores、render、ui。组件负责装配和交互，纯派生值用 computed/纯函数；Store 管理异步状态及生命周期，不依赖渲染器。
- 与网络、浏览器事件、计时器、订阅、流、图表实例同步时明确初始化与销毁；取消旧请求，避免过期响应覆盖新状态。
- 保持 HttpOnly session cookie、写请求 CSRF、显式虚拟密钥推理的认证边界；不在截图、日志或示例中使用真实凭据。
- 路径路由与 legacy ?page=... 同时兼容，导航选中映射与后端静态路径共用 src/shared/WebUiPaths.ts。HTML 回退只覆盖页面路由，资源不存在须返回 404。
- 一个业务区里的「标签页」是侧边栏导航项与独立路径，不是页面内的 `UiTabs`。要新增一项：`NavigationData.ts` 加一条带页面 id 的条目 → `WebUiPaths.ts` 的 `pathPages`（入站）与 `pagePaths`（出站）加路径 → `PageRegistry.ts` 把页面 id 指到同一个组件文件 → 分区逻辑（如 `features/models/logic/ModelManagementSections.ts`）加映射。同组页面共用一个组件文件是刻意的：`PageRegistry` 按文件路径缓存异步组件，`<component :is>` 因此复用实例，切分区不会重新拉数据、也不会重置用量视图与日期范围；页面从 `currentPageKey` 取自己是谁，不要各自再解析一遍 URL。拆分沿用旧页面 id 作为 `enabled_ui_pages_internal_users` 的准入别名，否则老配置会把新页面全部隐藏。
- 下线一项时同样四处收口：`NavigationData.ts`、`PageRegistry.ts`、`WebUiPaths.ts` 的 `pagePaths` 删掉，入站 `pathPages` 留一条指向活页面的别名（`models/health` → `models`），查询形式的旧 id 加进 `NavigationLogic.ts` 的 `retiredPageRedirects`，旧 `?tab=` 值在分区逻辑里改指默认分区。只被该页面使用的组件、样式、store 与逻辑测试一起删；同一批数据在别处仍可见的部分（如 All Models 里的健康徽标用 `ModelHealthStore`）留在原处。后端管理端点不随页面删除，API 调用方与配置仓库仍在用。
- 表单类弹窗复用 `src/features/platform/ui/` 的分区组件，不要为每个对话框重写边框和间距：`UiSectionCard` 提供标题/说明/右上角操作/底部开关条，`UiEntryCard` 是带序号的条目框（`primary` 变体强调首项），`UiSwitchRow` 是「左说明、右开关」的一行，`UiEntryRemove` 是条目右侧统一的移除按钮。列表类配置（Fallback 目标、别名目标）都按这个结构表达顺序：序号即执行顺序，拖动把手（`UiDragHandle`）改序，键盘 ↑/↓/Home/End 等价可用；不要在序号之外再摆一组上下箭头按钮。条目按「弹窗里用 `UiEntryCard`、内联表单里用 `UiSortableRow`」二选一，两者共用 `UiSortableList` 的拖拽状态与落点高亮；无顺序语义的列表（时段、语义路由、缓存注入点）不要加这层交互。
- 图标用 `UiLucideIcon`，名字写 `GripVertical` 或 `GripVerticalIcon` 都可以：定义表由 lucide 生成、键名混用两种后缀，`resolveIconNodes` 统一解析。名字彻底写错时只会渲染空 `<svg>`，页面看起来像「什么都没画」，所以 `IconDefinitionsLogic.test.ts` 会扫描组件里的字面量名字并要求全部可解析。
- 模型列表的 Credentials 列按「可复用凭据 → 订阅 Provider → Manual」取值：订阅部署的账号由订阅运行时持有，没有 `litellm_credential_name`，要显示 Provider 品牌并链到该 Provider 的订阅账号页，不要退化成 “Manual”（逻辑在 `src/features/models/logic/ModelCredentialLogic.ts`，表格与手机卡片共用 `ModelCredentialCellComponent`）。
- 品牌按模型名里的品牌词判定（名字开头优先，其次名字中间），`anthropic/` 这类路径前缀只是协议兼容层，不能当品牌兜底；新增品牌只改 `src/shared/ModelFamily.ts` 的词干表，前后端共用。
- 列表里的品牌分组是**分组优先于排序**的：`ModelFamilyGrouping` 先按家族切段（未识别品牌排最前，其余按家族名排序），段内再保留当前排序/服务端顺序；模型表、别名表、手机端卡片用 `ModelFamilyLabel` 同一条家族带，不要各写一套分组逻辑。
- 表格列宽只设下限，不设权重：`UiTableColumn` 给一个 `minWidth`（表头单行放得下、常规内容不截断），`UiTable` 在出现 `minWidth` 时切到 `computeUiTableColumnWidths`——容器更宽就按各列下限等比放大填满，更窄就保持下限、由外层横向滚动。要让某列更宽只调它的 `minWidth`，不要再加每列权重。表头始终单行，列比文字窄时用省略号而不是折行撑高表头（`TableFilters.css`），所以长表头名要配得起它的下限，压不下去就换短名（如 `Model Access Group` → `Access Group`）。
- 一格里要放多个数值时压成一行：图标区分含义（如 Costs 的 `ArrowDownToLine` 输入、`ArrowUpFromLine` 输出、`Database` 缓存读取），数值紧跟图标，和日志 Tokens 列同一套读法；不要用多行 “In: … / Out: …” 文本，窄列里它只会折行或被截断。
- 表格里表达「有序候选」用带序号的 chip（Fallbacks 表的候选列、别名的 Resolution 列都是这个形态），不要写成 "A → B → C" 的灰色句子；保护性开关（如禁止递归）用带图标的 pill 加 tooltip 说明后果，不要用一整句灰字。
- 不得用 as any、@ts-ignore、放宽 tsconfig、关闭 ESLint 规则或新建违规基线掩盖问题。
- 修改后至少运行相关 Vitest、npm run typecheck、npm run lint、npm run format:check、npm run build 与 git diff --check。构建含类型检查也不能代替覆盖源码及测试的独立 typecheck。
- 测试分层：表单校验、请求体映射、状态流转和错误码处理放 Vitest 逻辑测试（node 环境，`src/**/*.test.ts`）；只有浏览器语义才写 Playwright 组件测试（`tests/platform-ui`，`npm run test:components`）——原生 dialog 的模态与焦点、剪贴板降级、图表指针命中、键盘与 aria 交互、滚动分页、流式增量。组件测试不断言像素、字号、阴影、渐变等样式数值，也不复制已由 Vitest 覆盖的 payload 断言。
- 前后截图须使用同一浏览器、视口、时区和合成数据；保留原图、SHA、DOM、请求记录和实际构建指纹。Vite dev 的截图是诊断，不代表生产产物验收。不用占位页、遮罩或统一像素容差替代核对。
- out 在静态截图读取期间保持不变。BuildRuntime 会校验前后源码指纹，保留上一发布产物的客户端静态资源，并写入构建来源与资源清单。
- 动效默认是不生效的：`src/features/platform/ui/styles/Foundation.css` 的 `*` 重置把 `animation-duration` 压到 1ms、`animation-iteration-count` 压到 1，避免界面整体抖动；确实需要动画的元素要像 `.ui-spinner` 那样显式 `!important` 取回时长与循环，并在 `prefers-reduced-motion: reduce` 下停用。光晕、呼吸这类提示性动效请放在伪元素上，别让承载信息的实心块自身淡入淡出。
- 入口 CSS 的链接带 `?b=<源码指纹>`：它是 index.html 里唯一长期同名的资源，内容不变则文件名不变，边缘缓存若在部署窗口存下 404，浏览器会整页丢掉基础样式。改这个行为前先读 `scripts/BuildRuntime.mjs` 里的说明。

根目录的共享环境、授权、保护已有修改、标准部署和线上核验约定继续适用。
