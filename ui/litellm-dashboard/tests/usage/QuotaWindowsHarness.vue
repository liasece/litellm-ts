<script setup lang="ts">
import { provide } from "vue";
import { createPriceDisplayStore, priceDisplayStoreKey } from "../../src/features/platform/stores/PriceDisplayStore";
import UsageUpstreamQuotaComponent from "../../src/features/usage/ui/UsageUpstreamQuotaComponent.vue";
provide(priceDisplayStoreKey, createPriceDisplayStore());
</script>
<template>
	<!-- 占满视口：配额窗口列的可分配宽度随视口变化，测试才能验证「宽了就伸」。 -->
	<div class="quota-harness">
		<UsageUpstreamQuotaComponent :enabled="true" />
	</div>
</template>
<style>
body {
	margin: 0;
	background: #fff;
}
.quota-harness {
	padding: 16px;
	box-sizing: border-box;
}
</style>
