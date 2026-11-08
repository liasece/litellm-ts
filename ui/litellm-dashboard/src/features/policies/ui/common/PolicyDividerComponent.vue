<template>
	<div class="policy-divider" :class="{ 'policy-divider--plain': !$slots.default }">
		<span v-if="$slots.default"
			><strong><slot /></strong
		></span>
	</div>
</template>
