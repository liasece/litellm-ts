import { computed, shallowReactive } from "vue";
import { complianceFrameworks } from "../data/PlaygroundComplianceData";
import type {
	ComplianceCategory,
	ComplianceFilter,
	ComplianceFramework,
	ComplianceOptions,
	CompliancePrompt,
	ComplianceQuickMessage,
	ComplianceResult,
} from "../support/PlaygroundComplianceModels";
import {
	combinedFrameworks,
	filterFrameworks,
	complianceVerdict,
	complianceCounts,
	filterComplianceResults,
	complianceExport,
} from "../logic/PlaygroundComplianceLogic";
import { csvPrompts } from "../logic/PlaygroundCsvLogic";
import { testCompliance } from "../api/PlaygroundComplianceApi";
import { createPlaygroundCatalogStore } from "./PlaygroundCatalogStore";
import { sendInference } from "../api/PlaygroundInferenceApi";
export function createPlaygroundComplianceStore(options: ComplianceOptions = {}) {
	const catalog = createPlaygroundCatalogStore(),
		state = shallowReactive({
			policies: [] as string[],
			guardrails: [] as string[],
			selected: new Set<string>(),
			expandedFrameworks: new Set([complianceFrameworks[0]?.name ?? ""]),
			expandedCategories: new Set<string>(),
			search: "",
			custom: [] as CompliancePrompt[],
			showAdd: false,
			newText: "",
			newExpected: "fail" as "fail" | "pass",
			showCsv: false,
			csvError: null as string | null,
			rightTab: "quick-test" as "quick-test" | "batch-results",
			input: "",
			quickMessages: [] as ComplianceQuickMessage[],
			quickLoading: false,
			results: [] as ComplianceResult[],
			running: false,
			filter: "all" as ComplianceFilter,
			expandedResults: new Set<string>(),
		}),
		frameworks = computed(() => combinedFrameworks(complianceFrameworks, state.custom)),
		filtered = computed(() => filterFrameworks(frameworks.value, state.search)),
		prompts = computed(() => frameworks.value.flatMap((framework) => framework.categories.flatMap((category) => category.prompts))),
		counts = computed(() => complianceCounts(state.results)),
		results = computed(() => filterComplianceResults(state.results, state.filter));
	let batchController: AbortController | undefined,
		quickController: AbortController | undefined,
		batchGeneration = 0,
		quickGeneration = 0;
	function toggle(field: "selected" | "expandedFrameworks" | "expandedCategories" | "expandedResults", value: string) {
		const next = new Set(state[field]);
		if (next.has(value)) next.delete(value);
		else next.add(value);
		state[field] = next;
	}
	function togglePrompts(items: CompliancePrompt[]) {
		const all = items.every((prompt) => state.selected.has(prompt.id)),
			next = new Set(state.selected);
		for (const item of items)
			if (all) next.delete(item.id);
			else next.add(item.id);
		state.selected = next;
	}
	function toggleFramework(framework: ComplianceFramework) {
		togglePrompts(framework.categories.flatMap((category) => category.prompts));
	}
	function toggleCategory(category: ComplianceCategory) {
		togglePrompts(category.prompts);
	}
	function addPrompt() {
		if (!state.newText.trim()) return;
		state.custom = [
			...state.custom,
			{
				id: "custom-" + Date.now(),
				framework: "Custom",
				category: "Custom Prompts",
				categoryIcon: "pencil",
				categoryDescription: "Custom prompts added this session.",
				prompt: state.newText.trim(),
				expectedResult: state.newExpected,
			},
		];
		state.newText = "";
		state.newExpected = "fail";
		state.showAdd = false;
		state.expandedFrameworks = new Set([...state.expandedFrameworks, "Custom"]);
		state.expandedCategories = new Set([...state.expandedCategories, "Custom Prompts"]);
	}
	function deletePrompt(id: string) {
		state.custom = state.custom.filter((prompt) => prompt.id !== id);
		const selected = new Set(state.selected);
		selected.delete(id);
		state.selected = selected;
	}
	async function uploadCsv(file: File) {
		state.csvError = null;
		if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
			state.csvError = "Please upload a .csv file.";
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			state.csvError = "File too large (max 5 MB).";
			return;
		}
		try {
			const values = csvPrompts(await file.text());
			state.custom = [...state.custom, ...values];
			state.expandedFrameworks = new Set([...state.expandedFrameworks, ...values.map((prompt) => prompt.framework)]);
			state.expandedCategories = new Set([...state.expandedCategories, ...values.map((prompt) => prompt.category)]);
			state.selected = new Set([...state.selected, ...values.map((prompt) => prompt.id)]);
			state.showCsv = false;
		} catch (error) {
			state.csvError = error instanceof Error ? error.message : "Failed to parse CSV file.";
		}
	}
	function configuration() {
		return {
			policy_names: state.policies.length ? [...state.policies] : undefined,
			guardrail_names: state.guardrails.length ? [...state.guardrails] : undefined,
		};
	}
	async function quickTest() {
		if (!state.input.trim() || state.quickLoading) return;
		const text = state.input.trim(),
			current = ++quickGeneration,
			controller = new AbortController();
		quickController = controller;
		state.input = "";
		state.quickLoading = true;
		state.quickMessages = [...state.quickMessages, { id: crypto.randomUUID(), type: "user", text }];
		let result: ComplianceQuickMessage;
		try {
			if (options.backendMode === "chat_completions" && options.fixedModel?.()) {
				let response = "";
				await sendInference(
					{
						endpoint: "chat",
						auth: options.auth?.() ?? { kind: "session" },
						model: options.fixedModel() ?? "",
						agent: "",
						input: text,
						messages: [{ role: "user", content: text }],
						tags: [],
						guardrails: [...state.guardrails],
						policies: [...state.policies],
						vectorStores: [],
						mcpServers: [],
						selectedMcpServers: [],
						mcpRestrictions: {},
						traceId: crypto.randomUUID(),
						voice: "alloy",
						images: [],
						audio: null,
						customBaseUrl: options.baseUrl?.(),
						signal: controller.signal,
					},
					{ text: (chunk) => (response += chunk) },
				);
				result = {
					id: crypto.randomUUID(),
					type: "system",
					text: "Allowed — model response received.",
					result: "allowed",
					returnedText: response,
				};
			} else {
				const response = await testCompliance({ ...configuration(), inputs: { texts: [text] } }, controller.signal),
					verdict = complianceVerdict(response);
				result = {
					id: crypto.randomUUID(),
					type: "system",
					text:
						verdict.actualResult === "blocked"
							? "Blocked — " + (verdict.triggeredBy ?? "content filter")
							: "Allowed — no policy or guardrail violations detected.",
					result: verdict.actualResult,
					...verdict,
				};
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			result = { id: crypto.randomUUID(), type: "system", text: "Error: " + message, result: "blocked", triggeredBy: message };
		} finally {
			if (current === quickGeneration) state.quickLoading = false;
		}
		if (current === quickGeneration && !controller.signal.aborted) state.quickMessages = [...state.quickMessages, result];
	}
	async function run() {
		if (!state.selected.size || state.running) return;
		const current = ++batchGeneration,
			controller = new AbortController();
		batchController = controller;
		state.running = true;
		state.filter = "all";
		state.rightTab = "batch-results";
		const selected = prompts.value.filter((prompt) => state.selected.has(prompt.id)),
			pending: ComplianceResult[] = selected.map((prompt) => ({
				promptId: prompt.id,
				prompt: prompt.prompt,
				category: prompt.category,
				categoryIcon: prompt.categoryIcon,
				expectedResult: prompt.expectedResult,
				actualResult: "allowed",
				isMatch: false,
				status: "pending",
			}));
		state.results = pending;
		try {
			const response = await testCompliance(
				{
					...configuration(),
					inputs_list: selected.map((prompt) => ({ texts: [prompt.prompt] })),
					...(options.backendMode === "chat_completions" && options.fixedModel?.() ? { agent_id: options.fixedModel() } : {}),
				},
				controller.signal,
			);
			if (current !== batchGeneration || controller.signal.aborted) return;
			state.results = pending.map((row, index) => {
				const verdict = complianceVerdict(response.results?.[index]);
				return {
					...row,
					...verdict,
					isMatch: row.expectedResult === "fail" ? verdict.actualResult === "blocked" : verdict.actualResult === "allowed",
					status: "complete",
				};
			});
		} catch (error) {
			if (current !== batchGeneration || controller.signal.aborted) return;
			const message = error instanceof Error ? error.message : String(error);
			state.results = pending.map((row) => ({
				...row,
				actualResult: "blocked",
				isMatch: false,
				triggeredBy: "Error: " + message,
				status: "complete",
			}));
		} finally {
			if (current === batchGeneration) {
				state.running = false;
				batchController = undefined;
			}
		}
	}
	function stop() {
		batchController?.abort();
	}
	function reset() {
		batchGeneration++;
		quickGeneration++;
		batchController?.abort();
		quickController?.abort();
		state.running = false;
		state.quickLoading = false;
		state.policies = [];
		state.guardrails = [];
		state.results = [];
		state.quickMessages = [];
	}
	function exportResults() {
		if (!results.value.length) return;
		const url = URL.createObjectURL(new Blob([complianceExport(results.value)], { type: "text/csv" })),
			link = document.createElement("a");
		link.href = url;
		link.download = "compliance_batch_results_" + new Date().toISOString().slice(0, 10) + ".csv";
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 0);
	}
	function dispose() {
		batchGeneration++;
		quickGeneration++;
		batchController?.abort();
		quickController?.abort();
		catalog.dispose();
	}
	return {
		state,
		catalog,
		frameworks,
		filtered,
		prompts,
		counts,
		results,
		toggle,
		toggleFramework,
		toggleCategory,
		addPrompt,
		deletePrompt,
		uploadCsv,
		quickTest,
		run,
		stop,
		reset,
		exportResults,
		dispose,
	};
}
export type PlaygroundComplianceStore = ReturnType<typeof createPlaygroundComplianceStore>;
