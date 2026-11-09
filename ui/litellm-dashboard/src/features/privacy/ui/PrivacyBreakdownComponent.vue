<script setup lang="ts">
import { computed } from "vue";
import UiTag from "../../platform/ui/UiTag.vue";
import {
	privacyBreakdownLabel,
	privacyBreakdownNote,
	privacyCount,
	privacyKindTone,
	privacyShare,
	privacyShareWidth,
} from "../logic/PrivacyLogic";
import type { PrivacyBreakdownRow } from "../support/PrivacyModels";
defineOptions({ name: "PrivacyBreakdownComponent" });
const props = defineProps<{ dimension: "client" | "provider" | "kind"; rows: readonly PrivacyBreakdownRow[]; emptyText: string }>();
const total = computed(() => props.rows.reduce((sum, row) => sum + row.occurrences, 0));
</script>
<template>
	<ul class="privacy-breakdown">
		<li v-for="row in rows" :key="row.name" class="privacy-breakdown__row">
			<div class="privacy-breakdown__line">
				<span class="privacy-breakdown__name">
					<UiTag v-if="dimension === 'kind'" :color="privacyKindTone(row.name)">{{
						privacyBreakdownLabel(dimension, row.name)
					}}</UiTag>
					<template v-else>{{ privacyBreakdownLabel(dimension, row.name) }}</template>
				</span>
				<span class="privacy-breakdown__count">{{ privacyCount(row.occurrences) }}</span>
			</div>
			<div class="privacy-breakdown__bar" aria-hidden="true">
				<span :style="{ width: privacyShareWidth(row.occurrences, total) + '%' }" />
			</div>
			<div class="privacy-breakdown__note">
				{{ privacyBreakdownNote(dimension, row) }} · {{ privacyShare(row.occurrences, total) }}
			</div>
		</li>
		<li v-if="rows.length === 0" class="privacy-breakdown__empty">{{ emptyText }}</li>
	</ul>
</template>
