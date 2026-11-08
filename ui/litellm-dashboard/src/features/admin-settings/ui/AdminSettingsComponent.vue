<script setup lang="ts">
import { ref } from "vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiSettings from "./UiSettingsComponent.vue";
import PriceDisplaySettings from "./PriceDisplaySettingsComponent.vue";
import "./AdminSettingsStyles.css";
const tab = ref("ui-settings");
</script>
<template>
	<div class="admin-settings-page">
		<h4>Admin Access</h4>
		<p>Go to 'Internal Users' page to add other admins.</p>
		<UiTabs
			v-model="tab"
			:items="[
				{ key: 'ui-settings', label: 'UI Settings' },
				{ key: 'price-display', label: '价格显示' },
			]"
			><UiSettings v-if="tab === 'ui-settings'" /><PriceDisplaySettings v-else
		/></UiTabs>
	</div>
</template>
