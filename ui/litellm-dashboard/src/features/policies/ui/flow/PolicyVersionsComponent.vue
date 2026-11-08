<script setup lang="ts">
import type { Policy, PolicyVersionStatus } from "../../support/PolicyModels";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
defineProps<{
	versions: Policy[];
	selectedId?: string;
	status?: PolicyVersionStatus;
	loading: boolean;
	creating: boolean;
	updating: boolean;
}>();
defineEmits<{ create: []; select: [policy: Policy]; publish: []; promote: [] }>();
</script>
<template>
	<aside class="policy-versions">
		<div>
			<section>
				<h4>Versions</h4>
				<p>Production = the version used when anyone calls this policy by name.</p>
				<UiButton
					variant="primary"
					appearance="tremor"
					class="policy-full-width policy-mb12"
					:loading="creating"
					:disabled="creating"
					@click="$emit('create')"
					>+ New Version</UiButton
				>
				<div v-if="loading" class="policy-versions-loading"><UiSpinner :size="14" /></div>
				<span v-else-if="!versions.length" class="policy-versions-none">No versions found</span>
				<div v-else class="policy-version-list">
					<button
						v-for="version in versions"
						:key="version.policy_id"
						type="button"
						:class="{ 'is-selected': version.policy_id === selectedId }"
						@click="$emit('select', version)"
					>
						<strong>v{{ version.version_number ?? 1 }}</strong
						><span :class="'policy-version-status--' + (version.version_status ?? 'draft')">{{
							version.version_status ?? "draft"
						}}</span>
					</button>
				</div>
				<div v-if="status === 'draft' || status === 'published'" class="policy-version-publish">
					<template v-if="status === 'draft'"
						><UiButton
							appearance="tremor"
							variant="default"
							class="policy-full-width"
							:loading="updating"
							:disabled="updating"
							@click="$emit('publish')"
							>Publish</UiButton
						>
						<p>Published versions can be tested in the Playground before promoting to production.</p></template
					><template v-else
						><UiButton
							variant="primary"
							appearance="tremor"
							class="policy-full-width"
							:loading="updating"
							:disabled="updating"
							@click="$emit('promote')"
							>Promote to production</UiButton
						>
						<p>This version will be used when anyone calls this policy by name.</p></template
					>
				</div>
			</section>
			<section class="policy-mirroring">
				<h4>Silent Mirroring <span>COMING SOON</span></h4>
				<p>
					Test policy versions on production traffic without blocking requests. Shadow testing helps validate changes before full
					rollout.
				</p>
			</section>
		</div>
	</aside>
</template>
