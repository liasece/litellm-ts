import { ref } from "vue";
import { guardrailExecutionApi } from "../api/GuardrailExecutionApi";
import type { GuardrailTestResult, GuardrailTestError } from "../support/GuardrailTestModels";
import { notificationManager } from "../../notifications/logic/NotificationManager";
export function createGuardrailTestStore(authorized: () => boolean, api = guardrailExecutionApi) {
	const selected = ref(new Set<string>()),
		search = ref(""),
		results = ref<GuardrailTestResult[]>([]),
		errors = ref<GuardrailTestError[]>([]),
		pending = ref(false);
	function toggle(name: string | null) {
		if (!name) return;
		const next = new Set(selected.value);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		selected.value = next;
	}
	async function test(text: string) {
		if (!selected.value.size || !authorized()) return;
		pending.value = true;
		results.value = [];
		errors.value = [];
		const successes: GuardrailTestResult[] = [],
			failures: GuardrailTestError[] = [];
		await Promise.all(
			[...selected.value].map(async (name) => {
				const start = Date.now();
				try {
					const response = await api.apply(name, text);
					successes.push({ guardrailName: name, response_text: response.response_text, latency: Date.now() - start });
				} catch (error) {
					failures.push({
						guardrailName: name,
						error: error instanceof Error ? error : new Error(String(error)),
						latency: Date.now() - start,
					});
				}
			}),
		);
		results.value = successes;
		errors.value = failures;
		pending.value = false;
		if (successes.length)
			notificationManager.success(successes.length + " guardrail" + (successes.length > 1 ? "s" : "") + " applied successfully");
		if (failures.length) notificationManager.fromBackend(failures.length + " guardrail" + (failures.length > 1 ? "s" : "") + " failed");
	}
	return { selected, search, results, errors, pending, toggle, test };
}
