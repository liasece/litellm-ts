<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import { createPlaygroundAgentBuilderStore } from "../../stores/PlaygroundAgentBuilderStore";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiSpinner from "../../../platform/ui/UiSpinner.vue";
import UiTabs from "../../../platform/ui/UiTabs.vue";
import UiDialog from "../../../platform/ui/UiDialog.vue";
import PlaygroundAgentConfigurationComponent from "./PlaygroundAgentConfigurationComponent.vue";
import PlaygroundAgentConnectComponent from "./PlaygroundAgentConnectComponent.vue";
import PlaygroundChatComponent from "../chat/PlaygroundChatComponent.vue";
import PlaygroundComplianceComponent from "../compliance/PlaygroundComplianceComponent.vue";
import "./PlaygroundAgentStyles.css";
const auth = useAuthenticationStore(),
	store = createPlaygroundAgentBuilderStore(() => auth.state.session?.user_id ?? ""),
	state = store.state,
	disabled = computed(
		() =>
			Boolean(auth.state.session?.disabled_non_admin_personal_key_creation) &&
			!["Admin", "Admin Viewer"].includes(auth.userRole.value),
	),
	tabs = computed(() => [
		{ key: "configure", label: "Configure" },
		{ key: "chat", label: "Chat", disabled: state.selected === "__new__" },
		{ key: "test", label: "Batch Test", disabled: state.selected === "__new__" },
		{ key: "connect", label: "Connect", disabled: state.selected === "__new__" },
	]);
// AntD tabs mount on first visit and preserve their contents on later switches.
const visited = ref(new Set(["configure"]));
watch(
	() => state.tab,
	(tab) => {
		visited.value = new Set([...visited.value, tab]);
	},
	{ immediate: true },
);
const tabSlot = (key: string) => "tab-" + key;
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
defineExpose({ store });
</script>
<template>
	<div v-if="!auth.isAuthorized.value" class="pg-agent-signin">Sign in to use Agent Builder.</div>
	<div v-else class="pg-agent">
		<header>
			<div>
				<span>Agent Builder</span
				><UiButton
					v-if="state.selected === '__new__'"
					variant="primary"
					:loading="state.saving"
					:disabled="!state.name.trim() || !state.model"
					@click="store.save"
					><template #icon><UiIcon name="SaveOutlined" /></template>Save Agent</UiButton
				><small v-else>Build Agents that pass your compliance requirements.</small>
			</div>
			<div class="pg-agent__experimental">
				<UiIcon name="ExperimentOutlined" /><span
					>Agent Builder is experimental and may change or be removed without notice. We’d love your feedback—email us at
					<a href="mailto:product@berri.ai">product@berri.ai</a>.</span
				>
			</div>
		</header>
		<div class="pg-agent__layout">
			<aside>
				<header>
					<span>Agents</span
					><UiButton variant="text" size="small" aria-label="Add agent" @click="store.add"
						><UiIcon name="PlusOutlined"
					/></UiButton>
				</header>
				<div>
					<div v-if="state.loading" class="pg-agent__loading"><UiSpinner :size="16" /></div>
					<template v-else
						><button
							v-for="agent in state.agents"
							:key="agent.model_name"
							type="button"
							class="pg-agent__roster"
							:class="{ 'is-selected': state.selected === agent.model_name }"
							@click="store.select(agent.model_name)"
						>
							<strong>{{ agent.model_name }}</strong
							><small>litellm_agent</small></button
						><button type="button" class="pg-agent__new" @click="store.add">
							<UiIcon name="PlusOutlined" /> New agent
						</button></template
					>
				</div>
			</aside>
			<main>
				<div v-if="!state.selected && !state.agents.length && !state.loading" class="pg-agent__empty">
					No agents yet. Add an agent to get started.
				</div>
				<template v-if="state.selected"
					><UiTabs v-model="state.tab" :items="tabs"
						><template v-for="item in tabs" :key="item.key" #[tabSlot(item.key)]
							><span class="pg-agent__tab-label"
								><UiIcon
									:name="
										item.key === 'configure'
											? 'RobotOutlined'
											: item.key === 'chat'
												? 'CommentOutlined'
												: item.key === 'test'
													? 'ExperimentOutlined'
													: 'LinkOutlined'
									"
								/>{{ " " + item.label }}</span
							></template
						></UiTabs
					>
					<div v-show="state.tab === 'configure'" class="pg-agent__scroll">
						<PlaygroundAgentConfigurationComponent v-if="state.selected === '__new__' || store.selected.value" :store="store" />
					</div>
					<PlaygroundChatComponent
						v-if="visited.has('chat') && store.selected.value"
						v-show="state.tab === 'chat'"
						:key="store.selected.value.model_name"
						simplified
						:fixed-model="store.selected.value.model_name" /><PlaygroundComplianceComponent
						v-if="visited.has('test') && store.selected.value"
						v-show="state.tab === 'test'"
						backend-mode="chat_completions"
						:fixed-model="store.selected.value.model_name" />
					<div v-if="visited.has('connect') && store.selected.value" v-show="state.tab === 'connect'" class="pg-agent__scroll">
						<PlaygroundAgentConnectComponent :store="store" :disabled="disabled" /></div
				></template>
			</main>
		</div>
		<UiDialog v-model:open="state.confirmDelete" title="Delete agent" :width="416" scroll-mode="overlay"
			><p>Are you sure you want to delete "{{ store.selected.value?.model_name }}"? This cannot be undone.</p>
			<template #footer
				><UiButton @click="state.confirmDelete = false">Cancel</UiButton
				><UiButton variant="danger" :loading="state.deleting" @click="store.remove">Delete</UiButton></template
			></UiDialog
		>
	</div>
</template>
