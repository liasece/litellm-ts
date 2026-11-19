<script setup lang="ts">
import { copyText } from "../../content/logic/ClipboardLogic";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import UiTooltip from "../../platform/ui/UiTooltip.vue";
import { usePriceDisplayStore } from "../../platform/stores/PriceDisplayStore";
import ModelFamilyLabel from "../../providers/ui/ModelFamilyLabelComponent.vue";
import ModelName from "../../providers/ui/ModelNameComponent.vue";
import { deploymentIconProps, modelDisplayName, modelPriceIdentity } from "../logic/ModelDataLogic";
import { modelString, modelStrings, type DisplayProxyModel } from "../support/ModelModels";
import type { ModelFamilyGroup } from "../../providers/logic/ModelFamilyGrouping";
import type { ModelHealthStore } from "../stores/ModelHealthStore";
import ModelCredentialCell from "./ModelCredentialCellComponent.vue";
import ModelCooldownBadge from "./ModelCooldownBadgeComponent.vue";
import ModelHealthBadge from "./ModelHealthBadgeComponent.vue";
import UpstreamModelHint from "./UpstreamModelHintComponent.vue";
import { UPSTREAM_PRICE_FIELDS } from "../support/UpstreamModelInfoModels";
import { formatTokenCount } from "../support/UpstreamModelInfoModels";

const props = defineProps<{
	/** 已按品牌家族分组的行；卡片按组连续排布，组前有一条家族带。 */
	groups: readonly ModelFamilyGroup<DisplayProxyModel>[];
	health: ModelHealthStore;
	admin: boolean;
	userId: string;
	/** 订阅账号页的 `/ui` 前缀；订阅部署的凭据行链到对应 Provider 的账号。 */
	subscriptionsBase?: string;
}>();
const emit = defineEmits<{
	select: [id: string];
	fallback: [model: DisplayProxyModel];
	override: [model: DisplayProxyModel];
	convert: [model: DisplayProxyModel];
	delete: [model: DisplayProxyModel];
	credential: [name: string];
}>();
const price = usePriceDisplayStore();
function fallbackNames(model: DisplayProxyModel): string[] {
	return modelStrings(model.model_info.fallbacks);
}
function cost(model: DisplayProxyModel, value: number | null): string {
	return value == null ? "-" : price.format(value, 4, modelPriceIdentity(model));
}
function copy(value: string): void {
	void copyText(value).catch(() => undefined);
}
function select(model: DisplayProxyModel): void {
	const id = model.model_info.id;
	if (id) emit("select", id);
}
function deletable(model: DisplayProxyModel): boolean {
	return model.model_info.db_model !== false && (props.admin || model.model_info.created_by === props.userId);
}
/** 转换会改写路由配置并删除部署，按钮只在能完成这两件事时才出现。 */
function convertible(model: DisplayProxyModel): boolean {
	return props.admin && model.model_info.db_model !== false && Boolean(modelString(model.model_info.override_model_name));
}
</script>

<template>
	<ul class="model-cards">
		<template v-for="familyGroup in groups" :key="familyGroup.key">
			<li class="model-card-family">
				<ModelFamilyLabel :family="familyGroup.family" :count="familyGroup.items.length" />
			</li>
			<li v-for="model in familyGroup.items" :key="model.model_info.id ?? model.model_name" class="model-card" @click="select(model)">
				<div class="model-card__head">
					<div class="model-card__name">
						<ModelName
							v-bind="deploymentIconProps(model)"
							:name="modelDisplayName(model)"
							:size="20"
							variant="strong"
							class="model-card__title"
						/>
						<ModelName
							v-if="model.litellm_model_name"
							class="model-card__upstream"
							:model="model.litellm_model_name"
							:provider="model.provider"
							:size="14"
							:truncate="true"
						/>
					</div>
					<div class="model-card__tools">
						<button
							type="button"
							class="model-card__icon"
							aria-label="Copy model name"
							title="Copy model name"
							@click.stop="copy(modelDisplayName(model))"
						>
							<UiIcon name="CopyOutlined" :size="14" />
						</button>
						<UiTooltip
							:title="
								model.model_info.db_model === false
									? 'Config model cannot be deleted on the dashboard. Please delete it from the config file.'
									: 'Delete model'
							"
							><button
								type="button"
								class="model-card__icon model-card__icon--danger"
								:disabled="!deletable(model)"
								:aria-label="'Delete ' + model.model_name"
								@click.stop="emit('delete', model)"
							>
								<UiHeroIcon name="TrashIcon" :size="18" /></button
						></UiTooltip>
					</div>
				</div>
				<dl class="model-card__facts">
					<div class="model-card__fact">
						<dt>Health</dt>
						<dd>
							<ModelHealthBadge
								:model-id="modelString(model.model_info.id)"
								:status="health.state.statuses[modelString(model.model_info.id)]"
								@check="health.one(modelString(model.model_info.id))"
							/>
						</dd>
					</div>
					<div v-if="model.cooldown" class="model-card__fact">
						<dt>Cooldown</dt>
						<dd><ModelCooldownBadge :cooldown="model.cooldown" /></dd>
					</div>
					<div class="model-card__fact">
						<dt>Costs</dt>
						<dd class="model-card__cost">
							<span
								>In {{ cost(model, model.input_cost)
								}}<UpstreamModelHint
									:model="model.model_name"
									:record="model.upstream_model_info"
									field="input_cost_per_token"
									:fields="UPSTREAM_PRICE_FIELDS"
									:label="modelDisplayName(model)"
							/></span>
							<span
								>Out {{ cost(model, model.output_cost)
								}}<UpstreamModelHint
									:model="model.model_name"
									:record="model.upstream_model_info"
									field="output_cost_per_token"
									:fields="UPSTREAM_PRICE_FIELDS"
									:label="modelDisplayName(model)"
							/></span>
							<span v-if="model.cache_read_input_cost != null"
								>Cache read {{ cost(model, model.cache_read_input_cost)
								}}<UpstreamModelHint
									:model="model.model_name"
									:record="model.upstream_model_info"
									field="cache_read_input_token_cost"
									:fields="UPSTREAM_PRICE_FIELDS"
									:label="modelDisplayName(model)"
							/></span>
						</dd>
					</div>
					<div class="model-card__fact">
						<dt>Limits</dt>
						<dd class="model-card__cost">
							<span
								>Ctx {{ formatTokenCount(model.context_window)
								}}<UpstreamModelHint
									:model="model.model_name"
									:record="model.upstream_model_info"
									field="max_input_tokens"
									:label="modelDisplayName(model)"
							/></span>
							<span
								>Out {{ formatTokenCount(model.max_output_tokens)
								}}<UpstreamModelHint
									:model="model.model_name"
									:record="model.upstream_model_info"
									field="max_output_tokens"
									:label="modelDisplayName(model)"
							/></span>
						</dd>
					</div>
					<div v-if="model.model_info.access_groups?.length" class="model-card__fact">
						<dt>Access</dt>
						<dd class="model-access-badges">
							<span v-for="group in model.model_info.access_groups" :key="group" class="model-badge model-badge--blue">{{
								group
							}}</span>
						</dd>
					</div>
					<div class="model-card__fact">
						<dt>Fallback</dt>
						<dd class="model-card__inline">
							<span v-if="fallbackNames(model).length" class="model-fallback-list">
								<ModelName
									v-for="fallback in fallbackNames(model)"
									:key="fallback"
									class="model-fallback-name"
									:model="fallback"
									:size="14"
								/>
							</span>
							<span v-else class="model-muted">-</span>
							<button
								v-if="admin"
								type="button"
								class="model-card__icon model-card__icon--sm"
								:aria-label="'Edit fallbacks for ' + model.model_name"
								@click.stop="emit('fallback', model)"
							>
								<UiIcon name="EditOutlined" :size="14" />
							</button>
						</dd>
					</div>
					<div class="model-card__fact">
						<dt>Override</dt>
						<dd class="model-card__inline">
							<ModelName
								v-if="model.model_info.override_model_name"
								class="model-fallback-name"
								:model="model.model_info.override_model_name"
								:size="14"
							/>
							<span v-else class="model-muted">-</span>
							<button
								v-if="admin"
								type="button"
								class="model-card__icon model-card__icon--sm"
								:aria-label="'Edit override for ' + model.model_name"
								@click.stop="emit('override', model)"
							>
								<UiIcon name="EditOutlined" :size="14" />
							</button>
							<UiTooltip v-if="convertible(model)" title="Convert this model into an alias with the same target"
								><button
									type="button"
									class="model-card__icon model-card__icon--sm"
									:aria-label="'Convert ' + model.model_name + ' to an alias'"
									@click.stop="emit('convert', model)"
								>
									<UiIcon name="SwapOutlined" :size="14" /></button
							></UiTooltip>
						</dd>
					</div>
					<div class="model-card__fact">
						<dt>Credential</dt>
						<dd class="model-card__inline">
							<ModelCredentialCell
								:model="model"
								:subscriptions-base="subscriptionsBase"
								:icon-size="12"
								@credential="emit('credential', $event)"
							/>
						</dd>
					</div>
				</dl>
			</li>
		</template>
	</ul>
</template>
