import { requestJson } from "../../platform/api/HttpApiClient";
import { applicationApi } from "../../application/api/ApplicationApi";
export const themeSettingsApi = {
	load: applicationApi.theme,
	save: (logo: string, favicon: string) =>
		requestJson("/update/ui_theme_settings", {
			method: "PATCH",
			body: JSON.stringify({ logo_url: logo || null, favicon_url: favicon || null }),
		}),
};
