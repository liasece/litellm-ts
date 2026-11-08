import { computed, reactive } from "vue";
import { policiesApi } from "../api/PoliciesApi";
import { enrichPolicyStream } from "../api/PolicyEnrichmentStreamApi";
import { normalizeCompetitors } from "../logic/PolicyLogic";
import type { PolicyTemplate } from "../support/PolicyModels";
export function createPolicyParameterStore(template: () => PolicyTemplate | null) {
	const state = reactive({
		values: {} as Record<string, string>,
		mode: "ai",
		model: "",
		models: [] as string[],
		modelsLoading: false,
		competitors: [] as string[],
		variations: {} as Record<string, string[]>,
		generating: false,
		refining: false,
		refinement: "",
		generated: false,
		status: "",
	});
	let controller: AbortController | undefined,
		generation = 0;
	const enrichmentKey = computed(() => template()?.llm_enrichment?.parameter || "brand_name"),
		hasEnrichment = computed(() => !!template()?.llm_enrichment),
		parameters = computed(() => template()?.parameters ?? []),
		nonEnrichment = computed(() =>
			hasEnrichment.value ? parameters.value.filter((p) => p.name !== enrichmentKey.value) : parameters.value,
		),
		brandFilled = computed(() => !hasEnrichment.value || !!state.values[enrichmentKey.value]?.trim()),
		ready = computed(
			() =>
				nonEnrichment.value.filter((p) => p.required).every((p) => !!state.values[p.name]?.trim()) &&
				brandFilled.value &&
				(!hasEnrichment.value || state.competitors.length > 0),
		);
	function initialize() {
		generation++;
		controller?.abort();
		state.values = Object.fromEntries(parameters.value.map((p) => [p.name, ""]));
		state.mode = "ai";
		state.model = "";
		state.competitors = [];
		state.variations = {};
		state.generating = false;
		state.refining = false;
		state.refinement = "";
		state.generated = false;
		state.status = "";
		if (hasEnrichment.value && !state.models.length) void models();
	}
	async function models() {
		state.modelsLoading = true;
		try {
			state.models = await policiesApi.hubModels();
		} catch {
			/* Model choice remains available on the next open. */
		} finally {
			state.modelsLoading = false;
		}
	}
	async function generate(refine = false) {
		const value = template();
		if (!value || !state.model || !brandFilled.value || (refine && !state.refinement.trim())) return;
		controller?.abort();
		controller = new AbortController();
		const current = ++generation;
		state.status = "";
		if (refine) state.refining = true;
		else {
			state.generating = true;
			state.competitors = [];
			state.variations = {};
		}
		try {
			await enrichPolicyStream(
				value.id,
				{ ...state.values },
				state.model,
				{
					competitor: (name) => {
						if (current !== generation) return;
						state.competitors = refine ? normalizeCompetitors([...state.competitors, name]) : [...state.competitors, name];
					},
					done: (result) => {
						if (current !== generation) return;
						state.competitors = result.competitors;
						state.variations = result.competitor_variations;
						state.generating = false;
						state.refining = false;
						state.status = "";
						if (refine) state.refinement = "";
						else state.generated = true;
					},
					error: () => {
						if (current === generation) {
							state.generating = false;
							state.refining = false;
							state.status = "";
						}
					},
					status: (message) => {
						if (current === generation) state.status = message;
					},
				},
				refine ? { instruction: state.refinement.trim(), existingCompetitors: [...state.competitors] } : undefined,
				controller.signal,
			);
		} catch {
			if (current === generation) {
				state.generating = false;
				state.refining = false;
			}
		}
	}
	function dispose() {
		generation++;
		controller?.abort();
	}
	return { state, enrichmentKey, hasEnrichment, parameters, nonEnrichment, brandFilled, ready, initialize, models, generate, dispose };
}
