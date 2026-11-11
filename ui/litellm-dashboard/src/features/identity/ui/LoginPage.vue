<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import UiButton from "../../platform/ui/UiButton.vue";
import { useAuthenticationStore } from "../stores/AuthenticationStore";
import { createLoginPageStore } from "../stores/LoginPageStore";
import "./IdentityStyles.css";
import IdentityPasswordToggle from "./IdentityPasswordToggle.vue";
import IdentityInfoIcon from "./IdentityInfoIcon.vue";
import ApplicationBrandLogo from "../../application/ui/ApplicationBrandLogo.vue";

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
		<div class="identity-loading-brand"><ApplicationBrandLogo class="identity-loading-logo" /></div>
		<div class="identity-loading-progress"><span class="identity-spinner identity-spinner--small"></span><span>Loading...</span></div>
	</div>
	<div v-else class="identity-login-background">
		<section class="identity-login-card">
			<div class="identity-login-stack">
				<div class="identity-center">
					<h2 class="identity-brand"><ApplicationBrandLogo class="identity-brand-logo" /></h2>
				</div>
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
					</form>
				</template>
			</div>
		</section>
	</div>
</template>
