<script setup lang="ts">
defineEmits<{ "open-settings": [] }>();
</script>
<template>
	<div class="ld-config-info">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="12" cy="12" r="10" />
			<line x1="12" y1="16" x2="12" y2="12" />
			<line x1="12" y1="8" x2="12.01" y2="8" />
		</svg>
		<div>
			<h4>Request/Response Data Not Available</h4>
			<p>
				To view request and response details, enable prompt storage in your LiteLLM configuration by adding the following to your
				<code>proxy_config.yaml</code> file or <button type="button" @click="$emit('open-settings')">open the settings</button> to
				configure this directly.
			</p>
			<pre>
general_settings:
  store_model_in_db: true
  store_prompts_in_spend_logs: true</pre
			>
			<p class="ld-config-info__note">Note: This will only affect new requests after the configuration change.</p>
		</div>
	</div>
</template>
<style>
.ld-config-info {
	display: flex;
	align-items: flex-start;
	background: #eff6ff;
	border: 1px solid #bfdbfe;
	border-radius: 8px;
	padding: 16px;
	margin-bottom: 24px;
}
.ld-config-info > svg {
	flex: none;
	color: #3b82f6;
	margin-right: 12px;
	margin-top: 2px;
}
.ld-config-info h4 {
	font-size: 14px;
	font-weight: 500;
	color: #1e40af;
	margin: 0;
}
.ld-config-info p {
	font-size: 14px;
	color: #1d4ed8;
	margin-top: 4px;
}
.ld-config-info code {
	background: #dbeafe;
	padding: 2px 4px;
	border-radius: 4px;
}
.ld-config-info button {
	padding: 0;
	border: 0;
	background: none;
	color: #2563eb;
	text-decoration: underline;
	font-weight: 500;
	cursor: pointer;
}
.ld-config-info button:hover {
	color: #1e40af;
}
.ld-config-info pre {
	margin-top: 8px;
	background: #fff;
	padding: 12px;
	border: 1px solid #bfdbfe;
	border-radius: 4px;
	font:
		12px ui-monospace,
		SFMono-Regular,
		Menlo,
		monospace;
	overflow: auto;
}
.ld-config-info p.ld-config-info__note {
	font-size: 12px;
	margin-top: 8px;
}
</style>
