<script setup lang="ts">
import { onMounted } from "vue";
import { completeMcpOAuthCallback } from "../stores/McpOAuthCallbackStore";
import "./IdentityStyles.css";
onMounted(() => completeMcpOAuthCallback());
</script>

<template>
	<div class="identity-oauth-background">
		<section class="identity-oauth-card">
			<h1>LiteLLM MCP OAuth</h1>
			<p>Authorization complete. You may close this window and return to the LiteLLM dashboard.</p>
			<p class="identity-oauth-help">
				If the window does not close automatically, everything is still saved—you can close it manually.
			</p>
		</section>
	</div>
</template>
