<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createPlaygroundCompareStore } from "../../stores/PlaygroundCompareStore";
import { useAuthenticationStore } from "../../../identity/stores/AuthenticationStore";
import UiSelect from "../../../platform/ui/UiSelect.vue";
import PlaygroundComposerInputComponent from "../chat/PlaygroundComposerInputComponent.vue";
import PlaygroundPasswordInputComponent from "../chat/PlaygroundPasswordInputComponent.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
import UiButton from "../../../platform/ui/UiButton.vue";
import UiTooltip from "../../../platform/ui/UiTooltip.vue";
import PlaygroundComparisonPanelComponent from "./PlaygroundComparisonPanelComponent.vue";
import "./PlaygroundCompareStyles.css";
const auth = useAuthenticationStore(),
	disabled =
		Boolean(auth.state.session?.disabled_non_admin_personal_key_creation) && !["Admin", "Admin Viewer"].includes(auth.userRole.value),
	store = createPlaygroundCompareStore(disabled),
	state = store.state,
	fileInput = ref<HTMLInputElement>(),
	hasMessages = computed(() => state.comparisons.some((item) => item.history.state.messages.length)),
	loading = computed(() => state.comparisons.some((item) => item.loading)),
	allLoading = computed(() => state.comparisons.every((item) => item.loading)),
	allResponses = computed(() =>
		state.comparisons.every((item) => !item.loading && item.history.state.messages.some((message) => message.role === "assistant")),
	);
const suggestions = computed(() =>
	!hasMessages.value
		? ["Write me a poem", "Explain quantum computing", "Draft a polite email requesting a meeting"]
		: allResponses.value
			? ["Can you summarize the key points?", "What assumptions did you make?", "What are the next steps?"]
			: [],
);
function upload(event: Event) {
	store.file((event.target as HTMLInputElement).files?.[0] ?? null);
	(event.target as HTMLInputElement).value = "";
}
function key(event: KeyboardEvent) {
	if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
		event.preventDefault();
		if (!allLoading.value && (state.input.trim() || state.file)) void store.send();
	}
}
onMounted(() => void store.load());
onBeforeUnmount(store.dispose);
defineExpose({ store });
</script>
<template>
	<div class="pg-compare">
		<div class="pg-compare__card">
			<header>
				<div class="pg-inline">
					<label>Virtual Key Source</label
					><UiSelect
						:model-value="state.source"
						:options="[
							{ value: 'session', label: 'Current UI Session', disabled: !auth.isAuthorized.value },
							{ value: 'custom', label: 'Virtual Key' },
						]"
						:disabled="disabled"
						style="width: 192px"
						@update:model-value="state.source = String($event || 'session')"
					/><PlaygroundPasswordInputComponent
						v-if="state.source === 'custom'"
						v-model="state.apiKey"
						placeholder="Enter Virtual Key"
						style="width: 224px"
					/>
				</div>
				<div class="pg-inline">
					<UiButton :disabled="!hasMessages" @click="store.clear"
						><template #icon><UiIcon name="ClearOutlined" /></template>Clear All Chats</UiButton
					><UiTooltip :title="state.comparisons.length >= 3 ? 'Compare up to 3 models at a time' : 'Add another comparison'"
						><UiButton :disabled="state.comparisons.length >= 3" @click="store.add"
							><template #icon><UiIcon name="PlusOutlined" /></template>Add Comparison</UiButton
						></UiTooltip
					>
				</div>
			</header>
			<div class="pg-compare__panels" :style="{ gridTemplateColumns: 'repeat(' + state.comparisons.length + ',minmax(0,1fr))' }">
				<PlaygroundComparisonPanelComponent
					v-for="comparison in state.comparisons"
					:key="comparison.id"
					:comparison="comparison"
					:store="store"
				/>
			</div>
			<footer>
				<div>
					<div class="pg-compare__composer">
						<div class="pg-compare__suggestions">
							<span v-if="state.file">Attachment ready to send</span
							><template v-else-if="suggestions.length"
								><button
									v-for="suggestion in suggestions"
									:key="suggestion"
									type="button"
									@click="state.input = suggestion"
								>
									{{ suggestion }}
								</button></template
							><span v-else>{{
								loading ? "Gathering responses from all models..." : "Send a prompt to compare models"
							}}</span>
						</div>
						<div v-if="state.file" class="pg-upload-file">
							<span v-if="state.file.name.toLowerCase().endsWith('.pdf')" class="pg-upload-file__pdf"
								><UiIcon name="FilePdfOutlined" /></span
							><img v-else :src="state.preview" alt="Upload preview" />
							<div>
								<strong>{{ state.file.name }}</strong
								><small>{{ state.file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "Image" }}</small>
							</div>
							<button type="button" aria-label="Remove attachment" @click="store.file(null)">
								<UiIcon name="DeleteOutlined" />
							</button>
						</div>
						<input ref="fileInput" type="file" accept="image/*,.pdf" hidden @change="upload" />
						<div class="pg-composer__input">
							<div class="pg-composer__tools">
								<span class="pg-compare__attachment-wrap"
									><span class="pg-compare__attachment-table"
										><span class="pg-compare__attachment-cell">
											<UiTooltip title="Attach image or PDF"
												><button
													type="button"
													class="pg-attachment"
													aria-label="Attach image or PDF"
													@click="fileInput?.click()"
												>
													<UiIcon name="PaperClipOutlined" /></button></UiTooltip></span></span
								></span>
							</div>
							<PlaygroundComposerInputComponent
								v-model="state.input"
								:disabled="allLoading"
								placeholder="Type your message... (Shift+Enter for new line)"
								class="pg-composer__textarea"
								@keydown="key"
							/><UiButton
								aria-label="Send comparison message"
								class="pg-compare__send"
								:disabled="allLoading || (!state.input.trim() && !state.file)"
								@click="store.send"
								><UiIcon name="ArrowUpOutlined"
							/></UiButton>
						</div>
					</div>
				</div>
			</footer>
		</div>
	</div>
</template>
