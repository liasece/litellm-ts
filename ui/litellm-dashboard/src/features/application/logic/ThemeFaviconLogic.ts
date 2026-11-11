import { applicationApi } from "../api/ApplicationApi";

/**
 * Point the document icons at the configured theme favicon.
 *
 * The static app icon declared in index.html stays in place when the admin has not
 * configured a custom favicon, so the tab always shows the product icon.
 * @param url - Absolute HTTP(S) favicon URL from ui_theme_config, or null.
 */
export function applyThemeFavicon(url: string | null | undefined): void {
	if (!url) return;
	const links = document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']");
	if (links.length > 0) {
		links.forEach((link) => (link.href = url));
		return;
	}
	const link = document.createElement("link");
	link.rel = "icon";
	link.href = url;
	document.head.append(link);
}

/**
 * Load the public theme settings after the API base is known and apply a custom
 * favicon before the shell renders, including on the login page.
 */
export function applyConfiguredThemeFavicon(): void {
	void applicationApi
		.theme()
		.then((theme) => applyThemeFavicon(theme.favicon_url))
		.catch(() => undefined);
}
