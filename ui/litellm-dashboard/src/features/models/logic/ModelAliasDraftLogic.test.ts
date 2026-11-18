import { describe, expect, it } from "vitest";
import {
	aliasDraft,
	aliasDraftError,
	aliasTargetNames,
	aliasValueFromDraft,
	conversionAliasDraft,
	mergeAliasDraft,
	modelGroupDeploymentIds,
} from "./ModelAliasDraftLogic";
import type { DisplayProxyModel } from "../support/ModelModels";
import type { ModelGroupAliases } from "./ModelGroupAliasLogic";

function deployment(name: string, id: string | null, override: string | null = null): DisplayProxyModel {
	return {
		model_name: name,
		litellm_params: { model: "openai/" + name },
		model_info: { id, override_model_name: override },
		provider: "openai",
		litellm_model_name: null,
		input_cost: null,
		output_cost: null,
		cache_read_input_cost: null,
		api_base: null,
		cleanedLitellmParams: {},
		max_tokens: null,
		max_input_tokens: null,
	};
}

describe("converting an overridden model into an alias", () => {
	it("starts from the model's public name and its current override target", () => {
		const draft = conversionAliasDraft(deployment("gpt-5.5", "id-1", "gpt-5.6-terra"));
		expect(draft).toEqual({
			name: "gpt-5.5",
			targets: ["gpt-5.6-terra"],
			recurse: true,
			timezone: "Asia/Shanghai",
			schedule: [],
		});
	});

	it("keeps the routing target while the alias is edited before saving", () => {
		const draft = { ...conversionAliasDraft(deployment("gpt-5.5", "id-1", "gpt-5.6-terra")), targets: ["gpt-5.6-terra", "backup"] };
		const aliases = mergeAliasDraft({ existing: "other-model" }, draft);
		expect(aliases).toEqual({ existing: "other-model", "gpt-5.5": { targets: ["gpt-5.6-terra", "backup"] } });
	});

	it("replaces an alias of the same name in place instead of appending a duplicate", () => {
		const aliases: ModelGroupAliases = { first: "a", "gpt-5.5": "old-target", last: "b" };
		const draft = conversionAliasDraft(deployment("gpt-5.5", "id-1", "gpt-5.6-terra"));
		expect(mergeAliasDraft(aliases, draft, "gpt-5.5")).toEqual({ first: "a", "gpt-5.5": "gpt-5.6-terra", last: "b" });
	});

	it("deletes every deployment of the public name because an alias is keyed by that name", () => {
		const rows = [
			deployment("gpt-5.5", "id-1", "gpt-5.6-terra"),
			deployment("gpt-5.5", "id-2", "gpt-5.6-terra"),
			deployment("other", "id-3"),
		];
		expect(modelGroupDeploymentIds(rows, "gpt-5.5")).toEqual(["id-1", "id-2"]);
		expect(modelGroupDeploymentIds(rows, "missing")).toEqual([]);
	});
});

describe("alias drafts round-trip through the stored forms", () => {
	it("keeps a plain single target as a bare string", () => {
		expect(aliasValueFromDraft(aliasDraft("name", "target"))).toBe("target");
	});

	it("writes an object only when the draft needs fields a string cannot express", () => {
		const base = aliasDraft("name", "target");
		expect(aliasValueFromDraft({ ...base, recurse: false })).toEqual({ targets: ["target"], recurse: false });
		expect(aliasValueFromDraft({ ...base, targets: ["first", "second"] })).toEqual({ targets: ["first", "second"] });
		expect(aliasValueFromDraft({ ...base, timezone: "UTC", schedule: [{ start: "09:00", end: "12:00", model: " peak " }] })).toEqual({
			targets: ["target"],
			timezone: "UTC",
			schedule: [{ start: "09:00", end: "12:00", model: "peak" }],
		});
	});

	it("preserves protective fields the draft cannot edit", () => {
		expect(
			aliasValueFromDraft(aliasDraft("name", { targets: ["target"], hidden: true }), { targets: ["target"], hidden: true }),
		).toEqual({
			targets: ["target"],
			hidden: true,
		});
	});

	it("trims blank editor rows and drops them from the saved value", () => {
		const draft = { ...aliasDraft("name", undefined), targets: [" ", "target", ""] };
		expect(aliasValueFromDraft(draft)).toBe("target");
	});
});

describe("draft validation before saving", () => {
	const aliases: ModelGroupAliases = { taken: "model-a" };

	it("rejects a missing name, a missing target and a self reference", () => {
		expect(aliasDraftError(aliasDraft("", "model-a"), aliases)).toBe("Alias name is required");
		expect(aliasDraftError({ ...aliasDraft("new", undefined), targets: ["", " "] }, aliases)).toBe("At least one target is required");
		expect(aliasDraftError({ ...aliasDraft("new", "new"), targets: ["new"] }, aliases)).toBe("An alias cannot target itself");
	});

	it("refuses to overwrite another alias with the same name", () => {
		expect(aliasDraftError(aliasDraft("taken", "model-a"), aliases)).toBe(
			'An alias named "taken" already exists. Choose a different name.',
		);
		expect(aliasDraftError(aliasDraft("taken", "model-a"), aliases, "taken")).toBeNull();
	});

	it("accepts the converted draft for a free name", () => {
		expect(aliasDraftError(conversionAliasDraft(deployment("gpt-5.5", "id-1", "gpt-5.6-terra")), aliases)).toBeNull();
	});
});

describe("target options", () => {
	it("offers routable models plus aliases and the targets they declare", () => {
		expect(aliasTargetNames(["model-a", "model-b"], { older: "model-a", chained: { targets: ["retired-model"] } })).toEqual([
			"chained",
			"model-a",
			"model-b",
			"older",
			"retired-model",
		]);
	});
});
