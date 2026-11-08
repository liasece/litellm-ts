<script setup lang="ts">
import type { AttachmentImpact } from "../../support/PolicyModels";
import UiAlert from "../../../platform/ui/UiAlert.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
defineProps<{ impact: AttachmentImpact }>();
</script>
<template>
	<UiAlert :type="impact.affected_keys_count === -1 ? 'warning' : 'info'" title="Impact Preview" class="policy-mb16">
		<span v-if="impact.affected_keys_count === -1">Global scope — this will affect <strong>all keys and teams</strong>.</span>
		<template v-else
			><span
				>This attachment would affect
				<strong>{{ impact.affected_keys_count }} key{{ impact.affected_keys_count !== 1 ? "s" : "" }}</strong> and
				<strong>{{ impact.affected_teams_count }} team{{ impact.affected_teams_count !== 1 ? "s" : "" }}</strong
				>.</span
			>
			<div v-if="impact.sample_keys.length" class="policy-impact-samples">
				<span>Keys: </span><UiTag v-for="key in impact.sample_keys.slice(0, 5)" :key="key">{{ key }}</UiTag
				><small v-if="impact.affected_keys_count > 5">and {{ impact.affected_keys_count - 5 }} more...</small>
			</div>
			<div v-if="impact.sample_teams.length" class="policy-impact-samples">
				<span>Teams: </span><UiTag v-for="team in impact.sample_teams.slice(0, 5)" :key="team">{{ team }}</UiTag
				><small v-if="impact.affected_teams_count > 5">and {{ impact.affected_teams_count - 5 }} more...</small>
			</div>
		</template></UiAlert
	>
</template>
