<script setup lang="ts">
import { onMounted, ref } from "vue";
import NotificationLayer from "../../src/features/notifications/ui/NotificationLayerComponent.vue";
import KeyAliasesFields from "../../src/features/virtual-keys/ui/KeyAliasesFieldsComponent.vue";
import KeyRegenerateDialog from "../../src/features/virtual-keys/ui/KeyRegenerateDialogComponent.vue";
import { createKeyDraft } from "../../src/features/virtual-keys/logic/KeyDraftLogic";
import { parseVirtualKey } from "../../src/features/virtual-keys/api/VirtualKeysApi";
import { provideKeyFormIdentity } from "../../src/features/virtual-keys/support/KeyFormIdentity";
import "../../src/features/virtual-keys/ui/styles/VirtualKeyForms.css";
provideKeyFormIdentity("ordinary-key-fixture");
const draft = ref(createKeyDraft()),
	open = ref(false);
const regenerate = new URLSearchParams(location.search).get("mode") === "regenerate";
const keyData = parseVirtualKey({
	token: "synthetic-key-token",
	key_alias: "Synthetic key",
	max_budget: 100,
	tpm_limit: 10000,
	rpm_limit: 100,
	models: [],
	metadata: {},
});
onMounted(() => {
	if (regenerate) open.value = true;
});
</script>
<template>
	<NotificationLayer />
	<main style="padding: 24px; max-width: 1000px">
		<template v-if="!regenerate"
			><KeyAliasesFields v-model="draft" :models="['gpt-4.1', 'gpt-4.1-mini']" />
			<pre data-testid="aliases-value">{{ JSON.stringify(draft.aliases) }}</pre></template
		><KeyRegenerateDialog v-else v-model:open="open" :key-data="keyData" />
	</main>
</template>
