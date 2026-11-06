/**
 * WebUI 静态资源路径。
 *
 * 网关把 Next.js 静态导出挂载在 `/ui` 下（见 `src/ui/StaticUiRoutes.ts`），`public/` 里的
 * 文件因此对应 `/ui/<path>`。此前各模块直接写 `../ui/assets/logos/` 这类相对路径，解析结果
 * 取决于文档 URL 的目录层级：页面带尾斜杠时会拼成 `/ui/ui/assets/...`，全部 404。
 * 这里统一成绝对路径，页面层级变化不再影响资源定位。
 */

/** 静态资源根目录，对应 `public/assets/`。 */
export const UI_ASSETS_FOLDER = "/ui/assets/";

/** 供应商、工具与模型 logo 目录，对应 `public/assets/logos/`。 */
export const UI_LOGOS_FOLDER = `${UI_ASSETS_FOLDER}logos/`;
