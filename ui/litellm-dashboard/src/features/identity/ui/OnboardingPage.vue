<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import { useAuthenticationStore } from "../stores/AuthenticationStore";
import { createOnboardingStore } from "../stores/OnboardingStore";
import "./IdentityStyles.css";
import IdentityPasswordToggle from "./IdentityPasswordToggle.vue";
import IdentityInfoIcon from "./IdentityInfoIcon.vue";

const page = createOnboardingStore(useAuthenticationStore(), (destination) => window.location.assign(destination));
const state = page.state;
onMounted(() => void page.initialize());
onUnmounted(page.dispose);
</script>

<template>
	<div v-if="state.loading" class="identity-onboarding identity-center" role="status" aria-label="Loading">
		<span class="identity-spinner"></span>
	</div>
	<div v-else-if="state.loadError" class="identity-onboarding">
		<div class="identity-alert identity-alert--error">
			<IdentityInfoIcon tone="error" filled />
			<div>
				<div class="identity-alert-title">Failed to load invitation</div>
				<div class="identity-alert-description">The invitation link may be invalid or expired.</div>
			</div>
		</div>
		<div class="identity-onboarding-back"><a href="/ui/login" class="identity-link-button">Back to Login</a></div>
	</div>
	<div v-else class="identity-onboarding">
		<section class="identity-onboarding-card">
			<h5 class="identity-center identity-onboarding-brand">🚅 LiteLLM</h5>
			<h3>{{ state.variant === "reset_password" ? "Reset Password" : "Sign Up" }}</h3>
			<span>{{
				state.variant === "reset_password"
					? "Reset your password to access Admin UI."
					: "Claim your user account to login to Admin UI."
			}}</span>
			<div v-if="state.variant === 'signup'" class="identity-alert identity-alert--info identity-onboarding-sso">
				<IdentityInfoIcon filled />
				<div class="identity-full-width">
					<div class="identity-alert-title">SSO</div>
					<div class="identity-trial-row">
						<span>SSO is under the Enterprise Tier.</span
						><a
							class="identity-trial-button"
							href="https://forms.gle/W3U4PZpJGFHWtHyA9"
							target="_blank"
							rel="noopener noreferrer"
							>Get Free Trial</a
						>
					</div>
				</div>
			</div>
			<form class="identity-form identity-onboarding-form" novalidate @submit.prevent="page.submit">
				<div class="identity-form-item">
					<label for="onboarding-email">Email Address</label
					><input id="onboarding-email" class="identity-input" type="email" :value="state.userEmail" disabled />
				</div>
				<div
					class="identity-form-item identity-onboarding-password-item"
					:class="{ 'identity-form-item--error': state.passwordError }"
				>
					<label for="onboarding-password" class="identity-required-label">Password</label>
					<div class="identity-password">
						<input
							id="onboarding-password"
							v-model="state.password"
							class="identity-input"
							:type="state.showPassword ? 'text' : 'password'"
							autocomplete="new-password"
							:aria-invalid="Boolean(state.passwordError)"
							@input="state.passwordError = ''"
						/><IdentityPasswordToggle v-model:visible="state.showPassword" />
					</div>
					<div :class="state.passwordError ? 'identity-field-error' : 'identity-field-help'">
						{{ state.variant === "reset_password" ? "Enter your new password" : "Create a password for your account" }}
					</div>
				</div>
				<div
					v-if="state.error"
					class="identity-alert identity-alert--error identity-alert--compact identity-onboarding-error"
					role="alert"
				>
					<IdentityInfoIcon tone="error" filled />
					<div>{{ state.error }}</div>
				</div>
				<div class="identity-onboarding-submit">
					<UiButton type="submit" :loading="state.pending">{{
						state.variant === "reset_password" ? "Reset Password" : "Sign Up"
					}}</UiButton>
				</div>
			</form>
		</section>
	</div>
</template>
