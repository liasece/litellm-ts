<script setup lang="ts">
import { reactive } from "vue";
import { recordArray } from "../../logic/PrettyMessagesRealtimeLogic";
import { asRecord } from "../../logic/PrettyMessagesBlocksLogic";
import { getProviderLogoAndName } from "../../../providers/logic/ProviderIdentityLogic";
import LogDetailsCollapseComponent from "./LogDetailsCollapseComponent.vue";
import PrivacyPlaceholderText from "../../../content/ui/PrivacyPlaceholderText.vue";
defineProps<{ data: unknown }>();
const expanded = reactive(new Set<string>());
function toggle(key: string) {
	if (expanded.has(key)) expanded.delete(key);
	else expanded.add(key);
}
const date = (value: unknown) => new Date(Number(value) * 1000).toLocaleString();
</script>
<template>
	<LogDetailsCollapseComponent v-if="Array.isArray(data) && data.length" label="Vector Store Requests" default-open
		><div class="ld-vector">
			<div v-for="(request, index) in recordArray(data)" :key="index" class="ld-vector__request">
				<div class="ld-vector__summary ld-grid-two">
					<div>
						<div class="ld-kv">
							<strong>Query:</strong><span class="ld-mono">{{ request.query }}</span>
						</div>
						<div class="ld-kv">
							<strong>Vector Store ID:</strong><span class="ld-mono">{{ request.vector_store_id }}</span>
						</div>
						<div class="ld-kv">
							<strong>Provider:</strong
							><span class="ld-inline"
								><img
									v-if="getProviderLogoAndName(String(request.custom_llm_provider)).logo"
									:src="getProviderLogoAndName(String(request.custom_llm_provider)).logo"
									:alt="getProviderLogoAndName(String(request.custom_llm_provider)).displayName + ' logo'"
									width="20"
									height="20"
								/>{{ getProviderLogoAndName(String(request.custom_llm_provider)).displayName }}</span
							>
						</div>
					</div>
					<div>
						<div class="ld-kv">
							<strong>Start Time:</strong><span>{{ date(request.start_time) }}</span>
						</div>
						<div class="ld-kv">
							<strong>End Time:</strong><span>{{ date(request.end_time) }}</span>
						</div>
						<div class="ld-kv">
							<strong>Duration:</strong
							><span>{{ ((Number(request.end_time) - Number(request.start_time)) * 1000).toFixed(2) }}ms</span>
						</div>
					</div>
				</div>
				<h4>Search Results</h4>
				<div
					v-for="(result, i) in recordArray(asRecord(request.vector_store_search_response)?.data)"
					:key="i"
					class="ld-vector__result"
				>
					<button type="button" :aria-expanded="expanded.has(index + '-' + i)" @click="toggle(index + '-' + i)">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							:style="{ transform: expanded.has(index + '-' + i) ? 'rotate(90deg)' : undefined }"
						>
							<path d="M9 5l7 7-7 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg
						><strong>Result {{ i + 1 }}</strong
						><span class="ld-secondary"
							>Score: <span class="ld-mono">{{ Number(result.score).toFixed(4) }}</span></span
						>
					</button>
					<div v-if="expanded.has(index + '-' + i)" class="ld-vector__content">
						<div v-for="(content, j) in recordArray(result.content)" :key="j">
							<span class="ld-secondary">{{ content.type }}</span>
							<pre><PrivacyPlaceholderText :text="String(content.text ?? '')" /></pre>
						</div>
					</div>
				</div>
			</div></div
	></LogDetailsCollapseComponent>
</template>
