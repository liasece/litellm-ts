<script setup lang="ts">
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiPopover from "../../platform/ui/UiPopover.vue";
const props = defineProps<{ userId?: string | null; userAlias?: string | null; userEmail?: string | null }>();
async function copy(value: string) {
	await navigator.clipboard.writeText(value);
}
</script>
<template>
	<span v-if="!userId && !userAlias && !userEmail">-</span>
	<UiPopover v-else placement="bottomLeft"
		><span class="vk-user-cell">{{
			userId === "default_user_id" && !userAlias && !userEmail ? "Default Proxy Admin" : userAlias || userEmail || userId
		}}</span
		><template #content
			><div class="vk-user-popover">
				<div
					v-for="field in [
						{ label: 'User Alias', value: props.userAlias },
						{ label: 'User Email', value: props.userEmail },
						{ label: 'User ID', value: props.userId },
					]"
					:key="field.label"
				>
					<span>{{ field.label }}</span>
					<div>
						<code>{{ field.value || "-" }}</code
						><button v-if="field.value" type="button" :aria-label="'Copy ' + field.label" @click="copy(field.value)">
							<UiIcon name="CopyOutlined" />
						</button>
					</div>
				</div></div></template
	></UiPopover>
</template>
