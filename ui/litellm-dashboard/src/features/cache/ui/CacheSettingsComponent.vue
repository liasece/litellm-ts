<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiHeroIcon from "../../platform/ui/UiHeroIcon.vue";
import CacheFieldComponent from "./CacheFieldComponent.vue";
import { cacheApi, type CacheMetadata } from "../api/CacheApi";
import { cacheFieldGroups, collectCacheInputs, gatherCacheValues } from "../logic/CacheSettingsLogic";
import notification from "../../notifications/logic/NotificationManager";
const data = ref<CacheMetadata>({ fields: [], current_values: {}, redis_type_descriptions: {} }),
	redisType = ref("node"),
	advanced = ref(false),
	testing = ref(false),
	saving = ref(false),
	root = ref<HTMLElement>(),
	models = ref<{ value: string; label: string }[]>([]);
const groups = computed(() => cacheFieldGroups(data.value.fields));
const specific = computed(() =>
	redisType.value === "cluster"
		? groups.value.cluster
		: redisType.value === "sentinel"
			? groups.value.sentinel
			: redisType.value === "semantic"
				? groups.value.semantic
				: [],
);
async function load() {
	try {
		data.value = await cacheApi.settings();
		if (typeof data.value.current_values.redis_type === "string") redisType.value = data.value.current_values.redis_type;
	} catch {
		notification.fromBackend("Failed to load cache settings");
	}
}
onMounted(() => {
	void load();
	void cacheApi
		.models()
		.then(
			(values) =>
				(models.value = values
					.filter((model) => model.mode === "embedding")
					.map((model) => ({ value: String(model.model_group), label: String(model.model_group) }))
					.sort((left, right) => left.label.localeCompare(right.label))),
		)
		.catch(() => {});
});
function payload(save = false) {
	return gatherCacheValues(data.value.fields, redisType.value, root.value ? collectCacheInputs(root.value, data.value.fields) : {}, save);
}
async function test() {
	testing.value = true;
	try {
		const result = await cacheApi.test(payload());
		if (result.status === "success") notification.success("Cache connection test successful!");
		else notification.fromBackend("Connection test failed: " + String(result.message || result.error));
	} catch (error) {
		notification.fromBackend("Connection test failed: " + (error instanceof Error ? error.message : "Unknown error"));
	} finally {
		testing.value = false;
	}
}
async function save() {
	saving.value = true;
	try {
		await cacheApi.save(payload(true));
		notification.success("Cache settings updated successfully");
		await load();
	} catch {
		notification.fromBackend("Failed to update cache settings");
	} finally {
		saving.value = false;
	}
}
</script>
<template>
	<div ref="root" class="cache-settings-form">
		<section>
			<header>
				<h3>Cache Settings</h3>
				<p>Configure Redis cache for LiteLLM</p>
			</header>
			<div class="cache-redis-type">
				<label>Redis Type</label
				><UiSelect
					v-model="redisType"
					appearance="tremor"
					:options="[
						{ value: 'node', label: 'Node (Single Instance)' },
						{ value: 'cluster', label: 'Cluster' },
						{ value: 'sentinel', label: 'Sentinel' },
						{ value: 'semantic', label: 'Semantic' },
					]"
					aria-label="Redis Type"
				/>
				<p>{{ data.redis_type_descriptions[redisType] || "Select the type of Redis deployment you're using" }}</p>
			</div>
			<section class="cache-field-section">
				<h4>Connection Settings</h4>
				<div class="cache-field-grid">
					<CacheFieldComponent
						v-for="field in groups.basic"
						:key="field.field_name"
						:field="field"
						:current-value="data.current_values[field.field_name] ?? field.field_default ?? ''"
						:models="models"
					/>
				</div>
			</section>
			<section v-if="specific.length" class="cache-field-section">
				<h4>
					{{
						redisType === "cluster"
							? "Cluster Configuration"
							: redisType === "sentinel"
								? "Sentinel Configuration"
								: "Semantic Configuration"
					}}
				</h4>
				<div class="cache-field-grid" :class="{ 'cache-field-grid--single': redisType === 'cluster' }">
					<CacheFieldComponent
						v-for="field in specific"
						:key="field.field_name"
						:field="field"
						:current-value="data.current_values[field.field_name] ?? field.field_default ?? ''"
						:models="models"
					/>
				</div>
			</section>
			<div class="cache-advanced">
				<button type="button" :aria-expanded="advanced" @click="advanced = !advanced">
					<span>Advanced Settings</span><UiHeroIcon name="ChevronDownIcon" :size="16" :class="{ 'cache-rotated': advanced }" />
				</button>
				<div v-if="advanced" class="cache-advanced-body">
					<section
						v-for="group in [
							{ name: 'SSL Settings', fields: groups.ssl },
							{ name: 'Cache Management', fields: groups.management },
							{ name: 'GCP Authentication', fields: groups.gcp },
						].filter((group) => group.fields.length)"
						:key="group.name"
					>
						<h5>{{ group.name }}</h5>
						<div class="cache-field-grid">
							<CacheFieldComponent
								v-for="field in group.fields"
								:key="field.field_name"
								:field="field"
								:current-value="data.current_values[field.field_name] ?? field.field_default ?? ''"
								:models="models"
							/>
						</div>
					</section>
				</div>
			</div>
		</section>
		<footer class="cache-settings-actions">
			<UiButton appearance="tremor" :disabled="testing" @click="test">{{ testing ? "Testing..." : "Test Connection" }}</UiButton
			><UiButton appearance="tremor" variant="primary" :disabled="saving" @click="save">{{
				saving ? "Saving..." : "Save Changes"
			}}</UiButton>
		</footer>
	</div>
</template>
