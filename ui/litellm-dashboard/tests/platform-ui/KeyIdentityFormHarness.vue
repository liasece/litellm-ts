<script setup lang="ts">
import { ref } from "vue";
import { provideKeyFormIdentity } from "../../src/features/virtual-keys/support/KeyFormIdentity";
import { createKeyDraft } from "../../src/features/virtual-keys/logic/KeyDraftLogic";
import KeyFormFields from "../../src/features/virtual-keys/ui/KeyFormFieldsComponent.vue";
const props = defineProps<{ kind: string }>();
provideKeyFormIdentity(props.kind);
const draft = ref(createKeyDraft());
</script>
<template>
	<section>
		<KeyFormFields
			v-model="draft"
			:fields="[
				{ name: 'key_alias', kind: 'text', label: 'Key Alias' },
				{ name: 'metadataText', kind: 'textarea', label: 'Metadata' },
			]"
		/>
	</section>
</template>
