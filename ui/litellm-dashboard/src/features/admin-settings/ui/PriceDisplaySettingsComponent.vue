<script setup lang="ts">
import { computed, ref } from "vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import { usePriceDisplayStore, DEFAULT_PRICE_SETTINGS } from "../../platform/stores/PriceDisplayStore";
import { fetchExchangeRates } from "../../platform/logic/ExchangeRatesService";
const store = usePriceDisplayStore(),
	source = ref(store.state.settings.source),
	message = ref(""),
	saving = ref(false);
const currencies = computed(() =>
	[
		...new Set([
			"USD",
			"CNY",
			"EUR",
			"GBP",
			"JPY",
			"HKD",
			"SGD",
			...Object.keys(store.state.exchange?.rates || {}),
			store.state.settings.currency,
		]),
	]
		.filter(Boolean)
		.sort()
		.map((value) => ({ label: value, value })),
);
function currency(value: unknown) {
	try {
		store.save({ ...store.state.settings, currency: String(value ?? "USD") });
		message.value = "";
	} catch {
		message.value = "无法保存显示设置";
	}
}
async function save() {
	saving.value = true;
	message.value = "";
	try {
		const rates = await fetchExchangeRates(source.value);
		store.save({ ...store.state.settings, source: source.value });
		store.state.exchange = rates;
		message.value = "汇率源已验证并保存";
	} catch (error) {
		message.value = error instanceof Error ? error.message : "无法保存汇率源";
	} finally {
		saving.value = false;
	}
}
</script>
<template>
	<div class="admin-price-display">
		<h4>价格显示</h4>
		<p>仅转换显示金额，计费、预算、排序和数据库金额保持 USD。金额编辑框仍以 USD 输入。显示偏好保存在当前浏览器。</p>
		<div class="admin-price-currency">
			<span>全局显示币种</span
			><UiSelect
				:model-value="store.state.settings.currency"
				:options="currencies"
				searchable
				aria-label="价格显示币种"
				@update:model-value="currency"
			/>
		</div>
		<div>
			<span>汇率数据源</span><UiInput v-model="source" aria-label="汇率数据源" />
			<p class="admin-secondary">
				默认 Frankfurter / ECB 每日参考汇率。自定义 HTTPS 数据源须支持浏览器跨域访问，返回 USD 为基准的 Frankfurter v2 数组，或
				{base: 'USD', date: 'YYYY-MM-DD', rates: {CNY: 7.0, ...}}。不向汇率源发送登录凭据。
			</p>
			<div class="admin-price-actions">
				<UiButton :loading="saving" @click="save">验证并保存数据源</UiButton
				><UiButton @click="source = DEFAULT_PRICE_SETTINGS.source">恢复默认地址</UiButton>
			</div>
		</div>
		<p v-if="store.state.exchange">汇率日期：{{ store.state.exchange.date }} · 每小时刷新；超过 10 天的汇率不用于显示。</p>
		<UiAlert v-if="store.state.error" type="warning" :show-icon="false" :title="store.state.error" /><UiAlert
			v-if="message"
			type="info"
			:show-icon="false"
			:title="message"
		/>
	</div>
</template>
