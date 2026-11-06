import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { providerLogoMap } from "@/components/provider_info_helpers";
import { UI_ASSETS_FOLDER, UI_LOGOS_FOLDER } from "@/utils/uiAssets";

/** `public/` 在 Next 静态导出里对应 `/ui/`，因此把 URL 还原成磁盘路径。 */
const publicDir = join(process.cwd(), "public");
const toDiskPath = (url: string): string => join(publicDir, url.slice("/ui/".length));

describe("WebUI 静态资源路径", () => {
	it("静态资源目录挂载在 /ui 下，且 logos 是其子目录", () => {
		expect(UI_ASSETS_FOLDER.startsWith("/ui/")).toBe(true);
		expect(UI_LOGOS_FOLDER.startsWith(UI_ASSETS_FOLDER)).toBe(true);
	});

	it("供应商 logo 使用绝对 URL，指向的文件在 public 目录里真实存在", () => {
		const urls = Object.values(providerLogoMap);
		// 相对路径会随文档 URL 的层级解析（页面带尾斜杠时拼成 /ui/ui/assets/... 而 404）。
		const relative = urls.filter((url) => !url.startsWith("/") && !url.startsWith("https://"));
		expect(relative).toEqual([]);

		const localUrls = urls.filter((url) => url.startsWith(UI_LOGOS_FOLDER));
		expect(localUrls.length).toBeGreaterThan(50);
		const missing = localUrls.filter((url) => !existsSync(toDiskPath(url)));
		expect(missing).toEqual([]);
	});
});
