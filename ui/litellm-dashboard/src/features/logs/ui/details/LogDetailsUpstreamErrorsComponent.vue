<script setup lang="ts">
import type { UpstreamErrorView } from "../../logic/LogDetailsUpstreamErrorsLogic";

defineProps<{ errors: readonly UpstreamErrorView[] }>();
</script>

<template>
	<section v-if="errors.length" class="ld-upstream-errors ld-surface">
		<div class="ld-upstream-errors__title">Upstream errors ({{ errors.length }})</div>
		<ol class="ld-upstream-errors__list">
			<li v-for="(error, index) in errors" :key="index" class="ld-upstream-errors__item">
				<div class="ld-upstream-errors__meta">
					<strong>{{ error.label }}</strong>
					<span class="ld-upstream-errors__code"
						>{{ error.type }}<template v-if="error.code"> · {{ error.code }}</template></span
					>
				</div>
				<div class="ld-upstream-errors__message">{{ error.message }}</div>
				<div v-if="error.url" class="ld-upstream-errors__url ld-truncate" :title="error.url">{{ error.url }}</div>
			</li>
		</ol>
	</section>
</template>
