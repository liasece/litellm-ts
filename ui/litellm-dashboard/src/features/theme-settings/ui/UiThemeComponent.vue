<script setup lang="ts">
import { onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import { themeSettingsApi } from "../api/ThemeSettingsApi";
import { applyThemeFavicon } from "../../application/logic/ThemeFaviconLogic";
import notification from "../../notifications/logic/NotificationManager";
import "./UiThemeStyles.css";
const application = useApplicationStore(),
	logo = ref(""),
	favicon = ref(""),
	pending = ref(false);
function preview() {
	application.state.theme = { logo_url: logo.value || null, favicon_url: favicon.value || null };
	applyThemeFavicon(favicon.value);
}
function input(type: "logo" | "favicon", value: unknown) {
	if (type === "logo") logo.value = String(value ?? "");
	else favicon.value = String(value ?? "");
	preview();
}
onMounted(async () => {
	try {
		const settings = await themeSettingsApi.load();
		logo.value = settings.logo_url || "";
		favicon.value = settings.favicon_url || "";
		preview();
	} catch {
		/* The legacy page leaves local inputs empty if loading fails. */
	}
});
async function save(reset = false) {
	if (reset) {
		logo.value = "";
		favicon.value = "";
		preview();
	}
	pending.value = true;
	try {
		await themeSettingsApi.save(logo.value, favicon.value);
		preview();
		notification.success(reset ? "Theme settings reset to default!" : "Theme settings updated successfully!");
	} catch {
		notification.fromBackend(reset ? "Failed to reset theme settings" : "Failed to update theme settings");
	} finally {
		pending.value = false;
	}
}
</script>
<template>
	<div class="theme-settings">
		<header>
			<h2>UI Theme Customization</h2>
			<p>Customize your LiteLLM admin dashboard with a custom logo and favicon.</p>
		</header>
		<UiCard appearance="tremor" class="theme-settings-card">
			<div class="theme-settings-fields">
				<label
					><strong>Custom Logo URL</strong
					><UiInput
						:model-value="logo"
						appearance="tremor"
						placeholder="https://example.com/logo.png"
						@update:model-value="input('logo', $event)"
					/><small>Enter a URL for your custom logo or leave empty for default</small></label
				>
				<label
					><strong>Custom Favicon URL</strong
					><UiInput
						:model-value="favicon"
						appearance="tremor"
						placeholder="https://example.com/favicon.ico"
						@update:model-value="input('favicon', $event)"
					/><small>Enter a URL for your custom favicon (.ico, .png, or .svg) or leave empty for default</small></label
				>
				<div class="theme-settings-actions">
					<UiButton appearance="tremor" variant="primary" :loading="pending" :disabled="pending" @click="save()"
						>Save Changes</UiButton
					><UiButton appearance="tremor" :loading="pending" :disabled="pending" class="theme-reset" @click="save(true)"
						>Reset to Default</UiButton
					>
				</div>
			</div>
		</UiCard>
	</div>
</template>
