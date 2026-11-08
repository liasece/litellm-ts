<script setup lang="ts">
import type { DiffRow } from "../../logic/LogDetailsDiffLogic";
defineProps<{ row: DiffRow }>();
</script>
<template>
	<div class="ld-diff__row" :data-diff-kind="row.kind">
		<div
			v-for="side in ['left', 'right'] as const"
			:key="side"
			class="ld-diff__cell"
			:class="{
				'ld-diff__cell--remove': row.kind === 'change' && side === 'left',
				'ld-diff__cell--add': row.kind === 'change' && side === 'right',
			}"
		>
			<div class="ld-diff__number">{{ row[side]?.lineNumber ?? "" }}</div>
			<pre
				:class="{ 'ld-diff__empty': !row[side] }"
			><span :class="side === 'right' ? 'ld-diff__plus' : 'ld-diff__minus'" v-text="row.kind === 'change' ? (side === 'left' ? '−' : '+') : ' '"></span><span v-text="row[side]?.text ?? ''"></span></pre>
		</div>
	</div>
</template>
