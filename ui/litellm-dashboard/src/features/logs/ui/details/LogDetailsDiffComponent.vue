<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { formatDiffValue, buildFoldedDiffRows, getRequestProtocol } from "../../logic/LogDetailsDiffLogic";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import UiTabs from "../../../platform/ui/UiTabs.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import LogDetailsDiffRowComponent from "./LogDetailsDiffRowComponent.vue";
const props = defineProps<{
	downstreamRequest: unknown;
	upstreamRequest: unknown;
	downstreamResponse: unknown;
	upstreamResponse: unknown;
}>();
const active = ref("request"),
	expanded = reactive(new Set<number>());
const left = computed(() => formatDiffValue(active.value === "request" ? props.downstreamRequest : props.downstreamResponse)),
	right = computed(() => formatDiffValue(active.value === "request" ? props.upstreamRequest : props.upstreamResponse));
const rows = computed(() => buildFoldedDiffRows(left.value, right.value));
const downstreamProtocol = computed(() => getRequestProtocol(props.downstreamRequest)),
	upstreamProtocol = computed(() => getRequestProtocol(props.upstreamRequest));
const tabs = computed(() => [
	{ key: "request", label: "Request" },
	...(props.upstreamResponse !== null && props.upstreamResponse !== undefined ? [{ key: "response", label: "Response" }] : []),
]);
watch([left, right], () => expanded.clear());
</script>
<template>
	<div data-testid="upstream-downstream-diff">
		<UiAlert
			v-if="downstreamProtocol && upstreamProtocol && downstreamProtocol !== upstreamProtocol"
			type="warning"
			title="上下游协议不一致"
			class="ld-block-gap"
			>下游使用 {{ downstreamProtocol }}，上游使用 {{ upstreamProtocol }}。协议转换可能产生大量意料之外的
			diff，即使内容相同也可能被标记为差异。</UiAlert
		>
		<div class="ld-diff__legend">
			<span><UiTag color="red">− Downstream only</UiTag><UiTag color="green">＋ Upstream only</UiTag></span
			><span class="ld-secondary">Unchanged blocks are folded</span>
		</div>
		<UiTabs v-model="active" :items="tabs" />
		<div v-if="left === right" class="ld-diff__identical">No differences — the recorded payloads are identical.</div>
		<div v-else class="ld-diff">
			<div class="ld-diff__heading">
				<div>Downstream</div>
				<div>Upstream</div>
			</div>
			<div class="ld-diff__scroll">
				<template v-for="(row, index) in rows" :key="index"
					><template v-if="row.kind === 'fold'"
						><template v-if="expanded.has(index)"
							><LogDetailsDiffRowComponent v-for="(hidden, i) in row.hidden" :key="i" :row="hidden" /></template
						><button
							v-else
							class="ld-diff__fold"
							type="button"
							:aria-label="'Expand ' + row.hidden.length + ' unchanged lines'"
							@click="expanded.add(index)"
						>
							⋮ {{ row.hidden.length }} unchanged lines — click to expand
						</button></template
					><LogDetailsDiffRowComponent v-else :row="row"
				/></template>
			</div>
		</div>
	</div>
</template>
