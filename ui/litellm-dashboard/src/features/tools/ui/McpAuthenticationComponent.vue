<script setup lang="ts">
import { computed, watch } from "vue";
import UiButton from "../../platform/ui/UiButton.vue";
import McpFieldComponent from "./McpFieldComponent.vue";
import { objectValue } from "../logic/McpDraftLogic";
import type { createMcpOAuthFlowStore } from "../stores/McpOAuthFlowStore";
const draft = defineModel<Record<string, unknown>>({ required: true });
const props = defineProps<{
	editing?: boolean;
	errors?: Record<string, string>;
	oauth: ReturnType<typeof createMcpOAuthFlowStore>;
	docsUrl?: string | null;
}>();
const creds = computed(() => objectValue(draft.value.credentials)),
	m2m = computed(() => !props.editing && draft.value.oauth_flow_type === "m2m"),
	suffix = computed(() => (props.editing ? " (leave blank to keep existing)" : ""));
function credential(key: string, value: unknown) {
	draft.value.credentials = { ...creds.value, [key]: value };
}
watch(
	() => draft.value.auth_type,
	(value) => {
		if (value === "oauth2" && !draft.value.oauth_flow_type) draft.value.oauth_flow_type = "interactive";
	},
	{ immediate: true },
);
const authOptions = [
	{ value: "none", label: "None" },
	{ value: "api_key", label: "API Key" },
	{ value: "bearer_token", label: "Bearer Token" },
	{ value: "token", label: "Token" },
	{ value: "basic", label: "Basic Auth" },
	{ value: "oauth2", label: "OAuth" },
	{ value: "aws_sigv4", label: "AWS SigV4 (Bedrock AgentCore MCPs)" },
];
const awsFields = [
	{
		key: "aws_region_name",
		label: "AWS Region",
		placeholder: "us-east-1",
		required: true,
		tooltip: "AWS region for SigV4 signing (e.g., us-east-1)",
	},
	{
		key: "aws_service_name",
		label: "AWS Service Name",
		placeholder: "bedrock-agentcore",
		tooltip: "AWS service name for SigV4 signing. Defaults to 'bedrock-agentcore'.",
	},
	{
		key: "aws_access_key_id",
		label: "AWS Access Key ID",
		placeholder: "AKIA... (optional — uses IAM role if blank)",
		password: true,
		tooltip: "Optional. If not provided, falls back to the boto3 credential chain (IAM role, env vars, etc.).",
	},
	{
		key: "aws_secret_access_key",
		label: "AWS Secret Access Key",
		placeholder: "Enter secret key (optional — uses IAM role if blank)",
		password: true,
		tooltip: "Optional. Required if AWS Access Key ID is provided.",
	},
	{
		key: "aws_session_token",
		label: "AWS Session Token",
		placeholder: "Enter session token (optional)",
		password: true,
		tooltip: "Optional. Only needed for temporary STS credentials.",
	},
];
</script>
<template>
	<section class="tools-mcp-auth">
		<McpFieldComponent
			v-model="draft.auth_type"
			:searchable="false"
			:clearable="false"
			:label="editing ? 'Authentication' : undefined"
			type="select"
			:options="authOptions"
			:size="editing ? 'middle' : 'large'"
			placeholder="Select auth type"
			required
			:error="errors?.auth_type"
		/><McpFieldComponent
			v-if="['api_key', 'bearer_token', 'token', 'basic'].includes(String(draft.auth_type))"
			:model-value="creds.auth_value"
			label="Authentication Value"
			tooltip="Token, password, or header value to send with each request for the selected auth type."
			type="password"
			:appearance="editing ? 'antd' : 'tremor'"
			:show-password="editing"
			:placeholder="'Enter token or secret' + suffix"
			:error="errors?.auth_value"
			@update:model-value="credential('auth_value', $event)"
		/><template v-if="draft.auth_type === 'oauth2'"
			><McpFieldComponent
				v-if="!editing"
				v-model="draft.oauth_flow_type"
				:searchable="false"
				:clearable="false"
				label="OAuth Flow Type"
				tooltip="Choose how the proxy authenticates with this MCP server. M2M is for server-to-server communication using client credentials. Interactive (PKCE) is for user-facing flows that require browser-based authorization."
				type="select"
				size="large"
				:options="[
					{ value: 'm2m', label: 'Machine-to-Machine (M2M)', description: 'server-to-server, no user interaction' },
					{ value: 'interactive', label: 'Interactive (PKCE)', description: 'browser-based user authorization' },
				]"
			/><a v-if="!m2m && docsUrl" :href="docsUrl" target="_blank" rel="noopener noreferrer" class="tools-mcp-oauth-docs"
				>Create OAuth App →</a
			><McpFieldComponent
				:model-value="creds.client_id"
				:label="m2m ? 'Client ID' : 'Client ID (optional)'"
				:tooltip="
					m2m
						? 'OAuth2 client ID for the client_credentials grant.'
						: 'Provide only if your MCP server cannot handle dynamic client registration.'
				"
				type="password"
				:show-password="editing"
				:appearance="editing ? 'antd' : 'tremor'"
				:placeholder="(m2m ? 'Enter OAuth client ID' : 'Enter client ID') + suffix"
				:required="m2m"
				:error="errors?.client_id"
				@update:model-value="credential('client_id', $event)"
			/><McpFieldComponent
				:model-value="creds.client_secret"
				:label="m2m ? 'Client Secret' : 'Client Secret (optional)'"
				:tooltip="
					m2m
						? 'OAuth2 client secret for the client_credentials grant.'
						: 'Provide only if your MCP server cannot handle dynamic client registration.'
				"
				type="password"
				:show-password="editing"
				:appearance="editing ? 'antd' : 'tremor'"
				:placeholder="(m2m ? 'Enter OAuth client secret' : 'Enter client secret') + suffix"
				:required="m2m"
				:error="errors?.client_secret"
				@update:model-value="credential('client_secret', $event)"
			/><McpFieldComponent
				v-if="m2m"
				v-model="draft.token_url"
				label="Token URL"
				tooltip="Token endpoint URL for the client_credentials grant."
				placeholder="https://auth.example.com/oauth/token"
				:appearance="editing ? 'antd' : 'tremor'"
				required
				:error="errors?.token_url"
			/><McpFieldComponent
				:model-value="creds.scopes"
				label="Scopes (optional)"
				:tooltip="
					m2m
						? 'Optional scopes to request with the client_credentials grant.'
						: 'Optional scopes requested during token exchange. Separate multiple scopes with enter or commas.'
				"
				type="select"
				multiple
				creatable
				size="large"
				placeholder="Add scopes"
				@update:model-value="credential('scopes', $event)"
			/><template v-if="!m2m"
				><McpFieldComponent
					v-for="field in [
						{
							key: 'authorization_url',
							label: 'Authorization URL (optional)',
							path: 'authorize',
							tooltip: 'Optional override for the authorization endpoint.',
						},
						{
							key: 'token_url',
							label: 'Token URL (optional)',
							path: 'token',
							tooltip: 'Optional override for the token endpoint.',
						},
						{
							key: 'registration_url',
							label: 'Registration URL (optional)',
							path: 'register',
							tooltip: 'Optional override for the dynamic client registration endpoint.',
						},
					]"
					:key="field.key"
					v-model="draft[field.key]"
					:label="field.label"
					:tooltip="field.tooltip"
					:placeholder="'https://example.com/oauth/' + field.path"
					:appearance="editing ? 'antd' : 'tremor'"
				/>
				<aside class="tools-mcp-oauth-authorize">
					<p>Use OAuth to fetch a fresh access token and temporarily save it in the session as the authentication value.</p>
					<UiButton
						:appearance="editing ? 'antd' : 'tremor'"
						:disabled="['authorizing', 'exchanging'].includes(oauth.state.status)"
						@click="oauth.start"
						>{{
							oauth.state.status === "authorizing"
								? "Waiting for authorization..."
								: oauth.state.status === "exchanging"
									? "Exchanging authorization code..."
									: "Authorize & Fetch Token"
						}}</UiButton
					>
					<p v-if="oauth.state.error" class="tools-error">{{ oauth.state.error }}</p>
					<p v-if="oauth.state.status === 'success' && oauth.state.token?.access_token" class="tools-success">
						Token fetched. Expires in {{ oauth.state.token.expires_in ?? "?" }} seconds.
					</p>
				</aside></template
			></template
		><template v-if="draft.auth_type === 'aws_sigv4'"
			><p class="tools-mcp-aws-info">
				For MCP servers hosted on AWS Bedrock AgentCore.
				<a href="https://docs.litellm.ai/docs/mcp_aws_sigv4" target="_blank" rel="noopener noreferrer">View docs →</a>
			</p>
			<McpFieldComponent
				v-for="field in awsFields"
				:key="field.key"
				:model-value="creds[field.key]"
				:label="field.label"
				:required="!editing && field.required"
				:tooltip="field.tooltip"
				:type="field.password ? 'password' : 'text'"
				:show-password="field.password"
				:placeholder="field.placeholder"
				:error="errors?.[field.key]"
				@update:model-value="credential(field.key, $event)"
		/></template>
	</section>
</template>
