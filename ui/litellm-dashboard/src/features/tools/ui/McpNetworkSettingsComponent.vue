<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import AccessNoticeComponent from "../../access-control/ui/AccessNoticeComponent.vue";
import { mcpApi } from "../api/McpServersApi";
import { mcpSettingsApi } from "../api/McpSettingsApi";
import "../styles/McpSettingsStyles.css";
const loading = ref(true),
	saving = ref(false),
	ranges = ref<string[]>([]),
	ip = ref<string | null>(null),
	error = ref(""),
	message = ref(""),
	suggested = computed(() => {
		if (!ip.value) return null;
		const parts = ip.value.split(".");
		return parts.length === 4 ? parts.slice(0, 3).join(".") + ".0/24" : ip.value + "/32";
	});
onMounted(async () => {
	void mcpApi.clientIp().then((value) => {
		ip.value = value;
	});
	try {
		const fields = await mcpSettingsApi.general(),
			value = fields.find((field) => field.field_name === "mcp_internal_ip_ranges")?.field_value;
		if (Array.isArray(value)) ranges.value = value.filter((item): item is string => typeof item === "string");
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : String(reason);
	} finally {
		loading.value = false;
	}
});
async function save() {
	saving.value = true;
	try {
		if (ranges.value.length) {
			await mcpSettingsApi.update("mcp_internal_ip_ranges", ranges.value);
			message.value = "Successfully updated value!";
		} else {
			await mcpSettingsApi.reset("mcp_internal_ip_ranges");
			message.value = "Field reset on proxy";
		}
	} catch (reason) {
		error.value = reason instanceof Error ? reason.message : String(reason);
	} finally {
		saving.value = false;
	}
}
</script>
<template>
	<section class="tools-mcp-network">
		<AccessNoticeComponent :error="error" :message="message" />
		<p v-if="loading">Loading...</p>
		<template v-else
			><header>
				<h3>Private IP Ranges</h3>
				<p>
					Define which IP ranges are part of your private network. Callers from these IPs can see all MCP servers. Callers from
					any other IP can only see servers marked &quot;Available on Public Internet&quot;.
				</p>
			</header>
			<UiCard appearance="antd"
				><div v-if="ip" class="tools-mcp-current-ip">
					Your current IP: <code>{{ ip }}</code>
					<div v-if="suggested && !ranges.includes(suggested)">
						Suggested range:
						<UiTag color="blue" class="tools-mcp-suggested-range" @click="ranges = [...ranges, suggested]"
							><UiIcon name="PlusOutlined" />{{ suggested }}</UiTag
						>
					</div>
				</div>
				<strong>Your Private Network Ranges</strong
				><UiSelect
					v-model="ranges"
					:options="[]"
					multiple
					creatable
					clearable
					size="large"
					placeholder="Leave empty to use defaults: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8"
				/>
				<p>Enter CIDR ranges (e.g., 10.0.0.0/8). When empty, standard private IP ranges are used.</p></UiCard
			>
			<footer>
				<UiButton variant="primary" :loading="saving" @click="save"><UiIcon name="SaveOutlined" />Save</UiButton>
			</footer></template
		>
	</section>
</template>
