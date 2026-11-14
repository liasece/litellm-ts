<script setup lang="ts">
import { computed } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { appliedFeatures } from "../logic/LogsAppliedFeaturesLogic";
import type { LogEntry } from "../support/LogsModels";
const props = defineProps<{ log: LogEntry }>();
const badges = computed(() => appliedFeatures(props.log));
</script>

<template>
	<div v-if="badges.length" class="logs-features" data-testid="logs-features">
		<UiTooltip v-for="badge in badges" :key="badge.id" placement="top" popup-class="logs-feature-tip">
			<span
				class="logs-feature"
				:class="'logs-feature--' + badge.tone"
				:data-feature="badge.id"
				:aria-label="badge.label + (badge.detail ? '：' + badge.detail : '')"
			>
				<UiLucideIcon :name="badge.icon" :size="14" :stroke-width="2" />
				<span v-if="badge.count > 1" class="logs-feature-count">{{ badge.count }}</span>
			</span>
			<template #content>
				<div class="logs-feature-popover" :aria-label="badge.label">
					<div class="logs-feature-popover-title">
						<UiLucideIcon :name="badge.icon" :size="14" />{{ badge.label }}
						<span v-if="badge.count > 1" class="logs-feature-popover-count">×{{ badge.count }}</span>
					</div>
					<div class="logs-feature-popover-desc">{{ badge.description }}</div>
					<div v-if="badge.detail" class="logs-feature-popover-detail">{{ badge.detail }}</div>
				</div>
			</template>
		</UiTooltip>
	</div>
	<span v-else class="logs-feature-empty">-</span>
</template>
