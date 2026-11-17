<script setup lang="ts">
/**
 * 表单分区：把一组相关控件框起来，标题、说明、右上角操作和底部开关各就各位。
 * 弹窗里的分区都用它，避免每个对话框各写一套边框和间距。
 */
withDefaults(defineProps<{ title?: string; description?: string; required?: boolean }>(), {
	title: undefined,
	description: undefined,
	required: false,
});
</script>

<template>
	<section class="ui-section-card">
		<header class="ui-section-card__head">
			<div class="ui-section-card__heading">
				<h3 v-if="title" class="ui-section-card__title">
					{{ title }}<span v-if="required" class="ui-section-card__required" aria-hidden="true">*</span>
				</h3>
				<p v-if="description" class="ui-section-card__description">{{ description }}</p>
			</div>
			<div v-if="$slots.actions" class="ui-section-card__actions"><slot name="actions" /></div>
		</header>
		<div class="ui-section-card__body"><slot /></div>
		<footer v-if="$slots.footer" class="ui-section-card__foot"><slot name="footer" /></footer>
	</section>
</template>

<style scoped>
.ui-section-card {
	min-width: 0;
	border: 1px solid var(--ui-tremor-border);
	border-radius: 12px;
	background: var(--ui-surface);
	overflow: hidden;
}
.ui-section-card__head {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
	padding: 14px 16px 12px;
	border-bottom: 1px solid var(--ui-border-subtle);
}
.ui-section-card__heading {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}
.ui-section-card__title {
	margin: 0;
	font: 600 14px/20px var(--ui-font-sans);
	color: #111827;
}
.ui-section-card__required {
	margin-left: 4px;
	color: var(--ui-danger);
}
.ui-section-card__description {
	margin: 0;
	font: 400 12px/17px var(--ui-font-sans);
	color: var(--ui-text-muted);
}
.ui-section-card__actions {
	display: flex;
	align-items: center;
	gap: 8px;
	flex: none;
}
.ui-section-card__body {
	display: flex;
	flex-direction: column;
	gap: 8px;
	padding: 14px 16px;
}
.ui-section-card__foot {
	padding: 12px 16px;
	border-top: 1px solid var(--ui-border-subtle);
	background: var(--ui-surface-subtle);
}
/* 窄屏下标题和按钮并排会把说明文字挤成几行窄条，改为上下两段。 */
@media (max-width: 560px) {
	.ui-section-card__head {
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
	}
	.ui-section-card__actions {
		justify-content: flex-end;
	}
}
</style>
