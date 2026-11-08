<script setup lang="ts">
import { reactive, ref } from "vue";
import { recordArray } from "../../../logic/PrettyMessagesRealtimeLogic";
import { asRecord } from "../../../logic/PrettyMessagesBlocksLogic";
defineProps<{ entities: unknown }>();
const expanded = reactive(new Set<number>()),
	listExpanded = ref(true);
function toggle(index: number) {
	if (expanded.has(index)) expanded.delete(index);
	else expanded.add(index);
}
</script>
<template>
	<div v-if="Array.isArray(entities) && entities.length" class="ld-presidio">
		<button type="button" class="ld-presidio__heading" :aria-expanded="listExpanded" @click="listExpanded = !listExpanded">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" :style="{ transform: listExpanded ? 'rotate(90deg)' : undefined }">
				<path d="M9 5l7 7-7 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg
			>Detected Entities ({{ entities.length }})
		</button>
		<div v-if="listExpanded" class="ld-stack">
			<section v-for="(entity, index) in recordArray(entities)" :key="index" class="ld-presidio__entity">
				<button type="button" :aria-expanded="expanded.has(index)" @click="toggle(index)">
					<span class="ld-inline"
						><svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							:style="{ transform: expanded.has(index) ? 'rotate(90deg)' : undefined }"
						>
							<path d="M9 5l7 7-7 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg
						><strong>{{ entity.entity_type }}</strong
						><span class="ld-mono" :style="{ color: Number(entity.score) >= 0.8 ? '#16a34a' : '#ca8a04' }"
							>Score: {{ Number(entity.score).toFixed(2) }}</span
						></span
					><span class="ld-secondary">Position: {{ entity.start }}-{{ entity.end }}</span>
				</button>
				<div v-if="expanded.has(index)" class="ld-presidio__body ld-grid-two">
					<div>
						<div class="ld-kv">
							<strong>Entity Type:</strong><span>{{ entity.entity_type }}</span>
						</div>
						<div class="ld-kv">
							<strong>Position:</strong><span>Characters {{ entity.start }}-{{ entity.end }}</span>
						</div>
						<div class="ld-kv">
							<strong>Confidence:</strong
							><span :style="{ color: Number(entity.score) >= 0.8 ? '#16a34a' : '#ca8a04' }">{{
								Number(entity.score).toFixed(2)
							}}</span>
						</div>
					</div>
					<div>
						<template v-if="entity.recognition_metadata"
							><div class="ld-kv">
								<strong>Recognizer:</strong><span>{{ asRecord(entity.recognition_metadata)?.recognizer_name }}</span>
							</div>
							<div class="ld-kv">
								<strong>Identifier:</strong
								><span class="ld-truncate ld-mono" style="font-size: 12px">{{
									asRecord(entity.recognition_metadata)?.recognizer_identifier
								}}</span>
							</div></template
						>
						<div v-if="entity.analysis_explanation" class="ld-kv">
							<strong>Explanation:</strong><span>{{ entity.analysis_explanation }}</span>
						</div>
					</div>
				</div>
			</section>
		</div>
	</div>
</template>
