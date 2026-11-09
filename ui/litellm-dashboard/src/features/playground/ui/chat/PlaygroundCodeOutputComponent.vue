<script setup lang="ts">
import type { CodeInterpreterResult } from "../../support/PlaygroundModels";
import CodeHighlightComponent from "../../../content/ui/CodeHighlightComponent.vue";
import UiIcon from "../../../platform/ui/UiIcon.vue";
defineProps<{ result: CodeInterpreterResult }>();
</script>
<template>
	<div v-if="result.code" class="pg-code-output">
		<details>
			<summary><UiIcon name="RightOutlined" /><UiIcon name="CodeOutlined" /> Python Code Executed</summary>
			<CodeHighlightComponent
				:code="result.code"
				language="python"
				:custom-style="{ margin: 0, borderRadius: '6px', fontSize: '12px', maxHeight: '300px', overflow: 'auto' }"
			/>
		</details>
	</div>
</template>
