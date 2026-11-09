# LiteLLM Dashboard Vue 前端契约

本目录采用观澜 Web 工程栈：Vue 3、TypeScript、Vite、原生响应式 Store、普通 CSS、ECharts、Vue Router、Vitest、Playwright、ESLint 与 Prettier。具体版本以 package.json 和锁文件为准。

- 本次迁移的范围、截图证据和发布门禁见 ../../docs/frontend-vue-migration.md。保留现有外观、响应式布局、URL、权限、认证和业务交互；验收例外必须有用户明确决定。React 对照源码和产物位于 ../litellm-dashboard-react-reference，只供调查和回退。
- 不在当前运行时引入 React、Next、TanStack Query 或另一套组件设计。现有视觉由本项目 CSS 与 Vue 组件实现；复用的图标、算法和静态资源须保留来源及许可证。
- 按功能与职责组织 API、data、logic、stores、render、ui。组件负责装配和交互，纯派生值用 computed/纯函数；Store 管理异步状态及生命周期，不依赖渲染器。
- 与网络、浏览器事件、计时器、订阅、流、图表实例同步时明确初始化与销毁；取消旧请求，避免过期响应覆盖新状态。
- 保持 HttpOnly session cookie、写请求 CSRF、显式虚拟密钥推理的认证边界；不在截图、日志或示例中使用真实凭据。
- 路径路由与 legacy ?page=... 同时兼容，导航选中映射与后端静态路径共用 src/shared/WebUiPaths.ts。HTML 回退只覆盖页面路由，资源不存在须返回 404。
- 不得用 as any、@ts-ignore、放宽 tsconfig、关闭 ESLint 规则或新建违规基线掩盖问题。
- 修改后至少运行相关 Vitest、npm run typecheck、npm run lint、npm run format:check、npm run build 与 git diff --check。构建含类型检查也不能代替覆盖源码及测试的独立 typecheck。
- 测试分层：表单校验、请求体映射、状态流转和错误码处理放 Vitest 逻辑测试（node 环境，`src/**/*.test.ts`）；只有浏览器语义才写 Playwright 组件测试（`tests/platform-ui`，`npm run test:components`）——原生 dialog 的模态与焦点、剪贴板降级、图表指针命中、键盘与 aria 交互、滚动分页、流式增量。组件测试不断言像素、字号、阴影、渐变等样式数值，也不复制已由 Vitest 覆盖的 payload 断言。
- 前后截图须使用同一浏览器、视口、时区和合成数据；保留原图、SHA、DOM、请求记录和实际构建指纹。Vite dev 的截图是诊断，不代表生产产物验收。不用占位页、遮罩或统一像素容差替代核对。
- out 在静态截图读取期间保持不变。BuildRuntime 会校验前后源码指纹，保留上一发布产物的客户端静态资源，并写入构建来源与资源清单。

根目录的共享环境、授权、保护已有修改、标准部署和线上核验约定继续适用。
