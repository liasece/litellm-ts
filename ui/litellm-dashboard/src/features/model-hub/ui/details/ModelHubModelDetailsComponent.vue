<script setup lang="ts">
import { computed } from "vue";
import type { HubModel } from "../../support/ModelHubModels";
import { formatCapabilityName, modelCapabilities } from "../../logic/ModelHubFilterLogic";
import { adminModelCode, publicModelCode } from "../../logic/ModelHubCodeLogic";
import { useMoneyFormatter } from "../../../platform/stores/PriceDisplayStore";
import { getModelLogoAndName } from "../../../providers/logic/ProviderIdentityLogic";
import ProviderLogoComponent from "../../../providers/ui/ProviderLogoComponent.vue";
import ModelHubBadgeComponent from "../common/ModelHubBadgeComponent.vue";
import ModelHubCopyComponent from "../common/ModelHubCopyComponent.vue";
import ModelHubCodeExampleComponent from "./ModelHubCodeExampleComponent.vue";
import CodeHighlightComponent from "../../../content/ui/CodeHighlightComponent.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
const props = defineProps<{ model: HubModel | null; publicPage?: boolean }>(),
	emit = defineEmits<{ close: [] }>(),
	money = useMoneyFormatter(),
	capabilities = computed(() => (props.model ? modelCapabilities(props.model) : []));
const colors = ["green", "blue", "purple", "orange", "red", "yellow"];
</script>
<template>
	<UiDialog
		:open="Boolean(model)"
		:title="model?.model_group || 'Model Details'"
		:width="1000"
		:show-footer="false"
		scroll-mode="overlay"
		class="hub-details"
		@update:open="!$event && emit('close')"
	>
		<template #title
			><span class="hub-inline"
				><span>{{ model?.model_group || "Model Details" }}</span
				><ModelHubCopyComponent
					v-if="publicPage && model"
					:value="model.model_group"
					title="Copy model name"
					lucide
					:size="16" /></span
		></template>
		<div v-if="model" class="hub-details__sections">
			<section>
				<h3>Model Overview</h3>
				<div class="hub-details__grid hub-mb-16">
					<div>
						<strong>{{ publicPage ? "Model Name:" : "Model Group:" }}</strong>
						<p>{{ model.model_group }}</p>
					</div>
					<div>
						<strong>Mode:</strong>
						<p>{{ model.mode || "Not specified" }}</p>
					</div>
					<div>
						<strong>Providers:</strong>
						<div class="hub-tags hub-mt-4">
							<ModelHubBadgeComponent v-for="provider in model.providers" :key="provider" color="blue" :antd="publicPage"
								><span v-if="publicPage" class="hub-inline hub-provider-detail"
									><ProviderLogoComponent
										:provider="provider"
										:logo="getModelLogoAndName(provider, model.model_group).logo"
										image-class="hub-provider__image"
										fallback-class="hub-hidden"
									/><span class="hub-capitalize">{{ provider }}</span></span
								><template v-else>{{ provider }}</template></ModelHubBadgeComponent
							>
						</div>
					</div>
				</div>
				<div v-if="publicPage && model.model_group.includes('*')" class="hub-wildcard">
					<UiLucideIcon name="Info" :size="16" />
					<div>
						<strong>Wildcard Routing</strong>
						<p>
							Replace <code>*</code> with any matching value, for example
							<code>{{ model.model_group.replace("*", "my-custom-value") }}</code
							>.
						</p>
					</div>
				</div>
			</section>
			<section>
				<h3>Token &amp; Cost Information</h3>
				<div class="hub-details__grid">
					<div>
						<strong>Max Input Tokens:</strong>
						<p>{{ model.max_input_tokens?.toLocaleString() || "Not specified" }}</p>
					</div>
					<div>
						<strong>Max Output Tokens:</strong>
						<p>{{ model.max_output_tokens?.toLocaleString() || "Not specified" }}</p>
					</div>
					<div>
						<strong>Input Cost per 1M Tokens:</strong>
						<p>
							{{
								model.input_cost_per_token != null
									? money(model.input_cost_per_token * 1e6, publicPage ? 4 : 2, model)
									: "Not specified"
							}}
						</p>
					</div>
					<div>
						<strong>Output Cost per 1M Tokens:</strong>
						<p>
							{{
								model.output_cost_per_token != null
									? money(model.output_cost_per_token * 1e6, publicPage ? 4 : 2, model)
									: "Not specified"
							}}
						</p>
					</div>
				</div>
			</section>
			<section>
				<h3>Capabilities</h3>
				<div class="hub-tags hub-gap-8">
					<ModelHubBadgeComponent
						v-for="(capability, index) in capabilities"
						:key="capability"
						:color="colors[index % colors.length]"
						:antd="publicPage"
						>{{ formatCapabilityName(capability) }}</ModelHubBadgeComponent
					><span v-if="!capabilities.length">No special capabilities listed</span>
				</div>
			</section>
			<section v-if="model.tpm || model.rpm">
				<h3>Rate Limits</h3>
				<div class="hub-details__grid">
					<div v-if="model.tpm">
						<template v-if="publicPage">Tokens per Minute: {{ model.tpm.toLocaleString() }}</template
						><template v-else
							><strong>Tokens per Minute:</strong>
							<p>{{ model.tpm.toLocaleString() }}</p></template
						>
					</div>
					<div v-if="model.rpm">
						<template v-if="publicPage">Requests per Minute: {{ model.rpm.toLocaleString() }}</template
						><template v-else
							><strong>Requests per Minute:</strong>
							<p>{{ model.rpm.toLocaleString() }}</p></template
						>
					</div>
				</div>
			</section>
			<section v-if="model.supported_openai_params && (!publicPage || model.supported_openai_params.length)">
				<h3>Supported OpenAI Parameters</h3>
				<div class="hub-tags hub-gap-8">
					<ModelHubBadgeComponent
						v-for="parameter in model.supported_openai_params"
						:key="parameter"
						color="green"
						:antd="publicPage"
						>{{ parameter }}</ModelHubBadgeComponent
					>
				</div>
			</section>
			<ModelHubCodeExampleComponent v-if="publicPage" title="Usage Example" :code="publicModelCode(model)" />
			<section v-else>
				<h3>Usage Example</h3>
				<div class="hub-code-block">
					<CodeHighlightComponent :code="adminModelCode(model)" language="python" theme="prism" />
				</div>
			</section>
		</div>
	</UiDialog>
</template>
