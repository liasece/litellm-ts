<script setup lang="ts">
import { computed } from "vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import ProviderLogo from "../../providers/ui/ProviderLogoComponent.vue";
import { subscriptionCredential } from "../logic/ModelCredentialLogic";
import { modelString, type DisplayProxyModel } from "../support/ModelModels";

const props = defineProps<{ model: DisplayProxyModel; subscriptionsBase?: string; iconSize?: number }>();
const emit = defineEmits<{ credential: [name: string] }>();
/** 可复用凭据优先：它真的能点进凭据页复用。 */
const credentialName = computed(() => modelString(props.model.litellm_params.litellm_credential_name));
/** 没有凭据名的部署，若是第一方订阅 Provider 就展示品牌，而不是让人以为要手填密钥。 */
const subscription = computed(() => subscriptionCredential(props.model.provider, props.subscriptionsBase));
</script>
<template>
	<button v-if="credentialName" type="button" class="model-link model-inline" @click.stop="emit('credential', credentialName)">
		<UiIcon name="SyncOutlined" :size="iconSize" />{{ credentialName }}</button
	><UiTooltip
		v-else-if="subscription"
		:title="'Accounts and tokens for ' + subscription.brand.label + ' are managed on the Subscriptions page'"
		><a class="model-link model-inline model-subscription-credential" :href="subscription.href" @click.stop
			><ProviderLogo :provider="subscription.brand.label" :logo="subscription.brand.logo" /><span>{{
				subscription.brand.label
			}}</span></a
		></UiTooltip
	><span v-else class="model-inline model-muted"><UiIcon name="EditOutlined" :size="iconSize" />Manual</span>
</template>
