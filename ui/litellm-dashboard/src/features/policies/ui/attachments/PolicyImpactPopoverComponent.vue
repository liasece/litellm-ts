<script setup lang="ts">
import { ref } from "vue";
import type { PolicyAttachment, AttachmentImpact } from "../../support/PolicyModels";
import { policiesApi } from "../../api/PoliciesApi";
import UiPopover from "../../../platform/ui/UiPopover.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import UiTag from "../../../platform/ui/UiTag.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import PolicyHeroIconComponent from "../common/PolicyHeroIconComponent.vue";
const props = defineProps<{ attachment: PolicyAttachment }>(),
	impact = ref<AttachmentImpact | null>(null),
	loading = ref(false);
async function load(open: boolean) {
	if (!open || impact.value || loading.value) return;
	loading.value = true;
	try {
		const a = props.attachment;
		impact.value = await policiesApi.impact({
			policy_name: a.policy_name,
			scope: a.scope,
			teams: a.teams,
			keys: a.keys,
			models: a.models,
			tags: a.tags,
		});
	} catch {
		/* The popover remains retryable after an unavailable estimate. */
	} finally {
		loading.value = false;
	}
}
</script>
<template>
	<UiPopover trigger="click"
		><UiTooltip title="View blast radius"
			><button type="button" aria-label="View blast radius" @click="load(true)">
				<PolicyHeroIconComponent name="Eye" :size="20" /></button
		></UiTooltip>
		<template #content
			><div class="policy-impact-popover">
				<h4>Blast Radius</h4>
				<div v-if="loading" class="policy-impact-loading"><UiSpinner :size="14" /> Loading...</div>
				<template v-else-if="impact"
					><p v-if="impact.affected_keys_count === -1" class="policy-impact-global">Global scope — affects all keys and teams</p>
					<template v-else
						><p>
							<strong>{{ impact.affected_keys_count }}</strong> key{{ impact.affected_keys_count !== 1 ? "s" : "" }},
							<strong>{{ impact.affected_teams_count }}</strong> team{{ impact.affected_teams_count !== 1 ? "s" : "" }}
							affected
						</p>
						<div v-for="field in ['keys', 'teams'] as const" :key="field">
							<template v-if="impact[field === 'keys' ? 'sample_keys' : 'sample_teams'].length"
								><span>{{ field === "keys" ? "Keys: " : "Teams: " }}</span
								><UiTag v-for="value in impact[field === 'keys' ? 'sample_keys' : 'sample_teams']" :key="value">{{
									value
								}}</UiTag></template
							>
						</div>
						<p v-if="impact.affected_keys_count === 0 && impact.affected_teams_count === 0" class="policy-muted">
							No keys or teams currently affected
						</p></template
					></template
				>
				<p v-else class="policy-muted">Click to load</p>
			</div></template
		></UiPopover
	>
</template>
