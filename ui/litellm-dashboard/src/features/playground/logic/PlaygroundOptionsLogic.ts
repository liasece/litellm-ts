import { asRecord } from "./PlaygroundValueLogic";
export function policyOptions(policies: Record<string, unknown>[]) {
	return policies
		.filter((policy) => (policy.version_status ?? "draft") !== "draft")
		.map((policy) => {
			const status = String(policy.version_status ?? "draft"),
				name = String(policy.policy_name ?? "");
			return {
				label:
					name +
					" — v" +
					String(policy.version_number ?? 1) +
					" (" +
					status +
					")" +
					(policy.description ? " — " + String(policy.description) : ""),
				value: status === "production" ? name : policy.policy_id ? "policy_" + String(policy.policy_id) : name,
			};
		});
}
export const tagOptions = (tags: Record<string, unknown>) =>
	Object.values(tags).flatMap((value) => {
		const tag = asRecord(value);
		return typeof tag?.name === "string" ? [{ value: tag.name, label: tag.name }] : [];
	});
export const vectorOptions = (vectors: Record<string, unknown>[]) =>
	vectors.map((store) => ({
		value: String(store.vector_store_id),
		label: String(store.vector_store_name || store.vector_store_id) + " (" + String(store.vector_store_id) + ")",
	}));
export const guardrailOptions = (guardrails: Record<string, unknown>[]) =>
	guardrails.map((guardrail) => ({ value: String(guardrail.guardrail_name), label: String(guardrail.guardrail_name) }));
