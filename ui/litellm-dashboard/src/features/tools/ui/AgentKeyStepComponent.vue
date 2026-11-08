<script setup lang="ts">
import UiTag from "../../platform/ui/UiTag.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import AccessFieldComponent from "../../access-control/ui/AccessFieldComponent.vue";
import { useApplicationStore } from "../../application/stores/ApplicationStore";
import type { AgentFlowOptions, AgentKey } from "../support/AgentModels";
const options = defineModel<AgentFlowOptions>({ required: true });
const draft = defineModel<Record<string, unknown>>("draft", { required: true });
defineProps<{ keys: AgentKey[] }>();
const application = useApplicationStore();
</script>
<template>
	<section class="tools-agent-key-step">
		<div class="tools-agent-name-chip">
			<UiTag color="purple"><UiIcon name="RobotOutlined" />{{ draft.agent_name || "your-agent" }}</UiTag>
		</div>
		<AccessFieldComponent
			v-model="draft.team_id"
			name="agent-team"
			label="Assign to Team"
			tooltip="Optionally assign this agent to a team. The agent and its key will belong to the selected team."
			type="select"
			placeholder="Search or select a team"
			:options="
				application.state.teams.map((team) => ({
					value: team.team_id,
					label: ('team_alias' in team && typeof team.team_alias === 'string' && team.team_alias) || team.team_id,
				}))
			"
		/>
		<hr />
		<div
			class="tools-agent-key-option"
			:class="{ 'tools-agent-key-option--selected': options.keyOption === 'create_new' }"
			@click="options.keyOption = 'create_new'"
		>
			<input
				type="radio"
				name="key-option"
				:checked="options.keyOption === 'create_new'"
				@change="options.keyOption = 'create_new'"
			/>
			<div>
				<h4><UiIcon name="KeyOutlined" />Create a new key for this agent</h4>
				<p>A dedicated key scoped to this agent.</p>
				<div v-if="options.keyOption === 'create_new'" class="tools-agent-key-name" @click.stop>
					<label for="agent-new-key-name">Key Name</label
					><UiInput id="agent-new-key-name" v-model="options.keyName" placeholder="e.g. my-agent-key" />
				</div>
			</div>
			<UiTag color="green">Recommended</UiTag>
		</div>
		<div
			class="tools-agent-key-option"
			:class="{ 'tools-agent-key-option--selected': options.keyOption === 'existing_key' }"
			@click="options.keyOption = 'existing_key'"
		>
			<input
				type="radio"
				name="key-option"
				:checked="options.keyOption === 'existing_key'"
				@change="options.keyOption = 'existing_key'"
			/>
			<div>
				<h4><UiIcon name="KeyOutlined" />Assign an existing key</h4>
				<p>Re-assign a key you already have to this agent.</p>
				<div v-if="options.keyOption === 'existing_key'" @click.stop>
					<AccessFieldComponent
						v-model="options.existingKey"
						name="agent-existing-key"
						type="select"
						:options="keys.map((key) => ({ value: key.token, label: key.key_alias || key.token.slice(0, 12) + '…' }))"
						placeholder="Search by key name…"
					/>
				</div>
			</div>
		</div>
		<button class="tools-agent-skip-key" type="button" @click="options.keyOption = 'skip'">
			Skip for now — I'll assign a key later
		</button>
	</section>
</template>
