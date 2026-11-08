<script setup lang="ts">
import { computed, ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import { cacheHealthDetails } from "../logic/CacheHealthLogic";
const props = defineProps<{ response: Record<string, unknown> }>();
const tab = ref("summary"),
	expanded = ref<Record<string, boolean>>({});
const details = computed(() => cacheHealthDetails(props.response));
async function copy(value: string) {
	await navigator.clipboard.writeText(value);
}
</script>
<template>
	<div class="cache-health-panel">
		<UiTabs
			v-model="tab"
			appearance="tremor"
			:items="[
				{ key: 'summary', label: 'Summary' },
				{ key: 'raw', label: 'Raw Response' },
			]"
			><section v-if="tab === 'summary'" class="cache-health-summary">
				<div class="cache-health-status" :class="response.status === 'healthy' ? 'cache-success' : 'cache-failure'">
					<UiHeroIcon :name="response.status === 'healthy' ? 'CheckCircleIcon' : 'XCircleIcon'" :size="20" />
					<p>Cache Status: {{ response.status || "unhealthy" }}</p>
				</div>
				<table>
					<tbody>
						<tr
							v-for="row in details.rows"
							:key="row.label"
							:class="{ 'cache-health-section': row.section, 'cache-health-section--error': row.label === 'Error Details' }"
						>
							<td v-if="row.section">{{ row.label }}</td>
							<td v-else>
								<div class="cache-health-row">
									<button
										type="button"
										:aria-label="(expanded[row.label] ? 'Collapse ' : 'Expand ') + row.label"
										:aria-expanded="Boolean(expanded[row.label])"
										@click="expanded[row.label] = !expanded[row.label]"
									>
										{{ expanded[row.label] ? "▼" : "▶" }}
									</button>
									<div>
										<p>{{ row.label }}</p>
										<pre>{{
											expanded[row.label]
												? row.value
												: row.value.length > 50
													? row.value.slice(0, 50) + "..."
													: row.value
										}}</pre>
									</div>
									<button type="button" class="cache-copy" :aria-label="'Copy ' + row.label" @click="copy(row.value)">
										<UiHeroIcon name="ClipboardCopyIcon" :size="16" />
									</button>
								</div>
							</td>
						</tr>
					</tbody>
				</table>
			</section>
			<section v-else class="cache-health-raw">
				<pre>{{ details.raw }}</pre>
			</section></UiTabs
		>
	</div>
</template>
