<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useAuthenticationStore } from "../../identity/stores/AuthenticationStore";
import { copyText } from "../../content/logic/ClipboardLogic";
import { preferenceOptions as options } from "../data/BrowserPreferencesData";
import { useBrowserPreferences } from "../stores/BrowserPreferencesStore";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";

defineEmits<{ logout: [] }>();
const auth = useAuthenticationStore();
const open = ref(false),
	copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
const container = ref<HTMLElement>();
const { preferences, setPreference: updatePreference } = useBrowserPreferences();
const session = computed(() => auth.state.session);
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
function hover(entered: boolean) {
	clearTimeout(hoverTimer);
	hoverTimer = setTimeout(
		() => {
			open.value = entered;
		},
		entered ? 150 : 100,
	);
}
function outside(event: PointerEvent): void {
	if (event.target instanceof Node && !container.value?.contains(event.target)) open.value = false;
}
function escape(event: KeyboardEvent): void {
	if (event.key === "Escape") open.value = false;
}
async function copyUserId(): Promise<void> {
	if (!session.value?.user_id) return;
	await copyText(session.value.user_id);
	copied.value = true;
	clearTimeout(copiedTimer);
	copiedTimer = setTimeout(() => {
		copied.value = false;
	}, 2000);
}
onMounted(() => {
	document.addEventListener("pointerdown", outside);
	document.addEventListener("keydown", escape);
});
onUnmounted(() => {
	clearTimeout(hoverTimer);
	clearTimeout(copiedTimer);
	document.removeEventListener("pointerdown", outside);
	document.removeEventListener("keydown", escape);
});
</script>

<template>
	<div ref="container" class="application-user-menu" @pointerenter="hover(true)" @pointerleave="hover(false)">
		<button class="application-navbar-text-button" type="button" aria-haspopup="menu" :aria-expanded="open" @click="open = !open">
			<UiIcon name="UserOutlined" :size="14" /><span>User</span><UiIcon name="DownOutlined" :size="14" />
		</button>
		<div v-if="open" class="application-user-popup" role="menu" aria-label="User account">
			<div class="application-user-information">
				<div class="application-user-row">
					<span class="application-secondary"><UiIcon name="MailOutlined" />{{ session?.user_email || "-" }}</span
					><span class="application-membership" :class="{ 'application-membership--premium': session?.premium_user }"
						><UiIcon name="CrownOutlined" />{{ session?.premium_user ? "Premium" : "Standard" }}</span
					>
				</div>
				<hr />
				<div class="application-user-row">
					<span class="application-secondary"><UiIcon name="UserOutlined" />User ID</span
					><button class="application-copy-user" :title="session?.user_id" @click="copyUserId">
						{{ session?.user_id || "-" }}
						<UiIcon :name="copied ? 'CheckOutlined' : 'CopyOutlined'" :size="14" class="application-copy-user-icon" />
					</button>
				</div>
				<div class="application-user-row">
					<span class="application-secondary"><UiIcon name="SafetyOutlined" />Role</span><span>{{ auth.userRole.value }}</span>
				</div>
				<hr />
				<div v-for="option in options" :key="option.key" class="application-user-row">
					<span class="application-secondary">{{ option.label }}</span>
					<UiSwitch
						size="small"
						:model-value="preferences[option.key]"
						:aria-label="option.aria"
						@update:model-value="updatePreference(option.key, $event)"
					/>
				</div>
			</div>
			<button
				class="application-user-logout"
				role="menuitem"
				@click="
					$emit('logout');
					open = false;
				"
			>
				<UiIcon name="LogoutOutlined" />Logout
			</button>
		</div>
	</div>
</template>
