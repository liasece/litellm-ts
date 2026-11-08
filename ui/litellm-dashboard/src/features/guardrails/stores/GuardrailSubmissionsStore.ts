import { computed, reactive, ref, watch } from "vue";
import { guardrailSubmissionsApi } from "../api/GuardrailSubmissionsApi";
import { guardrailsApi } from "../api/GuardrailsApi";
import { submissionToGuardrail } from "../logic/GuardrailSubmissionLogic";
import type { SubmittedGuardrail, GuardrailSubmissionStatus } from "../support/GuardrailSubmissionModels";
import { notificationManager } from "../../notifications/logic/NotificationManager";
export function createGuardrailSubmissionsStore(authorized: () => boolean, api = guardrailSubmissionsApi, guardrails = guardrailsApi) {
	const rows = ref<SubmittedGuardrail[]>([]),
		summary = reactive({ total: 0, pending_review: 0, active: 0, rejected: 0 }),
		state = reactive({
			search: "",
			debounced: "",
			status: "all" as "all" | GuardrailSubmissionStatus,
			selectedId: "",
			loading: true,
			error: "",
		}),
		expanded = ref(new Set<string>()),
		confirmation = ref<{ id: string; action: "approve" | "reject" } | null>(null),
		selected = computed(() => rows.value.find((row) => row.id === state.selectedId) ?? null);
	let timer: ReturnType<typeof setTimeout> | undefined,
		generation = 0,
		disposed = false;
	const stops = [
		watch(
			() => state.search,
			(value) => {
				clearTimeout(timer);
				timer = setTimeout(() => (state.debounced = value), 300);
			},
		),
		watch(
			() => [state.debounced, state.status],
			() => void load(),
		),
	];
	async function load() {
		if (!authorized()) {
			state.loading = false;
			return;
		}
		const current = ++generation;
		state.loading = true;
		state.error = "";
		try {
			const response = await api.list({
				status: state.status === "all" ? undefined : state.status === "pending" ? "pending_review" : state.status,
				search: state.debounced.trim() || undefined,
			});
			if (!disposed && current === generation) {
				rows.value = response.submissions.map(submissionToGuardrail);
				Object.assign(summary, response.summary);
			}
		} catch (error) {
			if (!disposed && current === generation) {
				state.error = error instanceof Error ? error.message : "Failed to load submissions";
				rows.value = [];
			}
		} finally {
			if (!disposed && current === generation) state.loading = false;
		}
	}
	function replace(id: string, patch: Partial<SubmittedGuardrail>) {
		rows.value = rows.value.map((row) => (row.id === id ? { ...row, ...patch } : row));
	}
	async function forward(id: string) {
		if (!authorized()) return;
		const row = rows.value.find((row) => row.id === id);
		if (!row) return;
		const value = !row.forwardKey;
		try {
			await guardrails.update(id, { litellm_params: { forward_api_key: value } });
			replace(id, { forwardKey: value });
			notificationManager.success(value ? "Forward API key enabled" : "Forward API key disabled");
		} catch {
			notificationManager.fromBackend("Failed to update forward API key");
		}
	}
	async function headers(id: string, items: { key: string; value: string }[]) {
		if (!authorized()) return;
		const values: Record<string, string> = {};
		items.forEach((item) => {
			if (item.key.trim()) values[item.key.trim()] = item.value;
		});
		try {
			await guardrails.update(id, { litellm_params: { headers: values } });
			replace(id, { customHeaders: items.filter((item) => item.key.trim()) });
			notificationManager.success("Static headers updated");
		} catch {
			notificationManager.fromBackend("Failed to update static headers");
		}
	}
	async function extra(id: string, values: string[]) {
		if (!authorized()) return;
		try {
			await guardrails.update(id, { litellm_params: { extra_headers: values } });
			replace(id, { extraHeaders: values });
			notificationManager.success("Forward client headers updated");
		} catch {
			notificationManager.fromBackend("Failed to update forward client headers");
		}
	}
	async function review() {
		const value = confirmation.value;
		if (!value || !authorized()) return;
		try {
			await api.review(value.id, value.action);
			confirmation.value = null;
			if (state.selectedId === value.id) state.selectedId = "";
			await load();
			notificationManager.success("Guardrail " + (value.action === "approve" ? "approved" : "rejected"));
		} catch {
			notificationManager.fromBackend("Failed to " + value.action + " guardrail");
		}
	}
	function toggleHeaders(id: string) {
		const value = new Set(expanded.value);
		if (value.has(id)) value.delete(id);
		else value.add(id);
		expanded.value = value;
	}
	return {
		rows,
		summary,
		state,
		expanded,
		confirmation,
		selected,
		load,
		forward,
		headers,
		extra,
		review,
		toggleHeaders,
		dispose() {
			disposed = true;
			++generation;
			clearTimeout(timer);
			stops.forEach((stop) => stop());
		},
	};
}
