<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import UiButton from "../../platform/ui/UiButton.vue";
import { useAuthenticationStore } from "../stores/AuthenticationStore";
import { createLoginPageStore } from "../stores/LoginPageStore";
import "./IdentityStyles.css";
import IdentityPasswordToggle from "./IdentityPasswordToggle.vue";
import IdentityInfoIcon from "./IdentityInfoIcon.vue";

const auth = useAuthenticationStore();
const router = useRouter();
const page = createLoginPageStore(auth, (destination, replace = false) => {
	const resolved = new URL(destination, window.location.origin);
	if (resolved.origin !== window.location.origin) window.location.assign(destination);
	else
		void (replace
			? router.replace(resolved.pathname + resolved.search + resolved.hash)
			: router.push(resolved.pathname + resolved.search + resolved.hash));
});
const state = page.state;
onMounted(() => void page.initialize());
onUnmounted(page.dispose);
</script>

<template>
	<div v-if="auth.state.loading || state.loading" class="identity-loading" role="status" aria-label="Loading">
		<div class="identity-loading-brand">🚅 LiteLLM</div>
		<div class="identity-loading-progress"><span class="identity-spinner identity-spinner--small"></span><span>Loading...</span></div>
	</div>
	<div v-else class="identity-login-background">
		<section class="identity-login-card">
			<div class="identity-login-stack">
				<div class="identity-center"><h2 class="identity-brand">🚅 LiteLLM</h2></div>
				<template v-if="auth.state.config?.admin_ui_disabled">
					<div class="identity-alert identity-alert--warning">
						<IdentityInfoIcon tone="warning" filled />
						<div>
							<div class="identity-alert-title">Admin UI Disabled</div>
							<div class="identity-alert-description">
								<p>
									The Admin UI has been disabled by the administrator. To re-enable it, please update the following
									environment variable:
								</p>
								<p><code>DISABLE_ADMIN_UI=False</code></p>
							</div>
						</div>
					</div>
				</template>
				<template v-else>
					<div class="identity-center">
						<h3>Login</h3>
						<span class="identity-secondary">Access your LiteLLM Admin UI.</span>
					</div>
					<div class="identity-alert identity-alert--info">
						<IdentityInfoIcon />
						<div>
							<div class="identity-alert-title">Default Credentials</div>
							<div class="identity-alert-description">
								<p>
									By default, Username is <code>admin</code> and Password is your set LiteLLM
									Proxy<code>MASTER_KEY</code>.
								</p>
								<p>
									Need to set UI credentials or SSO?
									<a href="https://docs.litellm.ai/docs/proxy/ui" target="_blank" rel="noopener noreferrer"
										>Check the documentation</a
									>.
								</p>
							</div>
						</div>
					</div>
					<div v-if="auth.state.error" class="identity-alert identity-alert--error identity-alert--compact" role="alert">
						<IdentityInfoIcon tone="error" filled />
						<div>{{ auth.state.error }}</div>
					</div>
					<form class="identity-form" novalidate @submit.prevent="page.submit">
						<div
							v-if="auth.state.config?.is_control_plane && auth.state.config.workers?.length"
							class="identity-form-item identity-worker-field"
						>
							<label for="login-worker">Worker</label>
							<select id="login-worker" v-model="state.selectedWorkerId" class="identity-input identity-input--large">
								<option value="" disabled>Choose a worker to connect to</option>
								<option v-for="worker in auth.state.config.workers" :key="worker.worker_id" :value="worker.worker_id">
									{{ worker.name }}
								</option>
							</select>
						</div>
						<div class="identity-form-item" :class="{ 'identity-form-item--error': state.usernameError }">
							<label for="login-username">Username</label>
							<input
								id="login-username"
								v-model="state.username"
								class="identity-input identity-input--large"
								placeholder="Enter your username"
								autocomplete="username"
								:disabled="auth.state.pending"
								:aria-invalid="Boolean(state.usernameError)"
								@input="state.usernameError = ''"
							/>
							<div v-if="state.usernameError" class="identity-field-error">{{ state.usernameError }}</div>
						</div>
						<div class="identity-form-item" :class="{ 'identity-form-item--error': state.passwordError }">
							<label for="login-password">Password</label>
							<div class="identity-password">
								<input
									id="login-password"
									v-model="state.password"
									class="identity-input identity-input--large"
									:type="state.showPassword ? 'text' : 'password'"
									placeholder="Enter your password"
									autocomplete="current-password"
									:disabled="auth.state.pending"
									:aria-invalid="Boolean(state.passwordError)"
									@input="state.passwordError = ''"
								/><IdentityPasswordToggle v-model:visible="state.showPassword" size="large" />
							</div>
							<div v-if="state.passwordError" class="identity-field-error">{{ state.passwordError }}</div>
						</div>
						<div class="identity-form-item">
							<UiButton
								variant="primary"
								size="large"
								class="identity-full-width"
								type="submit"
								:loading="auth.state.pending"
								:disabled="auth.state.pending"
								>{{ auth.state.pending ? "Logging in..." : "Login" }}</UiButton
							>
						</div>
						<div class="identity-form-item">
							<span v-if="!auth.state.config?.sso_configured" class="identity-sso-popover" tabindex="0"
								><UiButton size="large" class="identity-full-width" disabled>Login with SSO</UiButton
								><span class="identity-popover-content" role="tooltip">Please configure SSO to log in with SSO.</span></span
							>
							<UiButton v-else size="large" class="identity-full-width" :disabled="auth.state.pending" @click="page.startSso"
								>Login with SSO</UiButton
							>
						</div>
					</form>
				</template>
			</div>
			<div
				v-if="auth.state.config?.sso_configured && !auth.state.config?.admin_ui_disabled && state.showSsoNotice"
				class="identity-alert identity-alert--info identity-alert--compact identity-sso-notice"
			>
				<IdentityInfoIcon filled />
				<div>
					Single Sign-On (SSO) is enabled. LiteLLM no longer automatically redirects to the SSO login flow upon loading this page.
					To re-enable auto-redirect-to-SSO, set <code>AUTO_REDIRECT_UI_LOGIN_TO_SSO=true</code> in your environment
					configuration.
				</div>
				<button type="button" class="identity-alert-close" aria-label="Close" @click="state.showSsoNotice = false">
					<svg viewBox="64 64 896 896" aria-hidden="true" focusable="false">
						<path
							fill="currentColor"
							fill-rule="evenodd"
							d="M799.86 166.31c.02 0 .04.02.08.06l57.69 57.7c.04.03.05.05.06.08a.12.12 0 010 .06c0 .03-.02.05-.06.09L569.93 512l287.7 287.7c.04.04.05.06.06.09a.12.12 0 010 .07c0 .02-.02.04-.06.08l-57.7 57.69c-.03.04-.05.05-.07.06a.12.12 0 01-.07 0c-.03 0-.05-.02-.09-.06L512 569.93l-287.7 287.7c-.04.04-.06.05-.09.06a.12.12 0 01-.07 0c-.02 0-.04-.02-.08-.06l-57.69-57.7c-.04-.03-.05-.05-.06-.07a.12.12 0 010-.07c0-.03.02-.05.06-.09L454.07 512l-287.7-287.7c-.04-.04-.05-.06-.06-.09a.12.12 0 010-.07c0-.02.02-.04.06-.08l57.7-57.69c.03-.04.05-.05.07-.06a.12.12 0 01.07 0c.03 0 .05.02.09.06L512 454.07l287.7-287.7c.04-.04.06-.05.09-.06a.12.12 0 01.07 0z"
						/>
					</svg>
				</button>
			</div>
		</section>
	</div>
</template>
