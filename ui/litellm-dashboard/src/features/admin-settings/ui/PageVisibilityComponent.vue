<script setup lang="ts">
import { computed, ref, watch } from "vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiCheckbox from "../../platform/ui/UiCheckbox.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import { pageGroups } from "../data/PageVisibilityData";
const props = defineProps<{ value?: string[] | null; description?: string; pending: boolean }>();
const emit = defineEmits<{ update: [value: string[] | null] }>();
const selected = ref<string[]>([]),
	open = ref(false);
const isSet = computed(() => props.value !== null && props.value !== undefined);
watch(
	() => props.value,
	(value) => (selected.value = [...(value || [])]),
	{ immediate: true },
);
function toggle(page: string, enabled: boolean) {
	selected.value = enabled ? [...selected.value, page] : selected.value.filter((value) => value !== page);
}
function reset() {
	selected.value = [];
	emit("update", null);
}
</script>
<template>
	<section class="admin-page-visibility">
		<div class="admin-page-visibility-copy">
			<div>
				<strong>Internal User Page Visibility</strong
				><UiTag :color="isSet ? 'blue' : 'default'">{{
					isSet ? selected.length + " page" + (selected.length !== 1 ? "s" : "") + " selected" : "Not set (all pages visible)"
				}}</UiTag>
			</div>
			<p v-if="description" class="admin-secondary">{{ description }}</p>
			<p class="admin-visibility-description">
				By default, all pages are visible to internal users. Select specific pages to restrict visibility.
			</p>
			<p class="admin-visibility-note">
				Note: Only pages accessible to internal user roles are shown here. Admin-only pages are excluded as they cannot be made
				visible to internal users regardless of this setting.
			</p>
		</div>
		<div class="admin-collapse">
			<button type="button" :aria-expanded="open" @click="open = !open">
				<UiIcon name="RightOutlined" :size="12" :class="{ 'admin-rotated': open }" />Configure Page Visibility
			</button>
			<div v-if="open" class="admin-collapse-body">
				<div v-for="group in pageGroups" :key="group.label" class="admin-page-group">
					<h5>{{ group.label }}</h5>
					<div>
						<UiCheckbox
							v-for="page in group.pages"
							:key="page.page"
							:model-value="selected.includes(page.page)"
							@update:model-value="toggle(page.page, $event)"
							><span class="admin-page-label"
								><span>{{ page.label }}</span
								><small>{{ page.description }}</small></span
							></UiCheckbox
						>
					</div>
				</div>
				<div class="admin-visibility-actions">
					<UiButton
						variant="primary"
						:disabled="pending"
						:loading="pending"
						@click="emit('update', selected.length ? [...selected] : null)"
						>Save Page Visibility Settings</UiButton
					><UiButton v-if="isSet" :disabled="pending" :loading="pending" @click="reset">Reset to Default (All Pages)</UiButton>
				</div>
			</div>
		</div>
	</section>
</template>
