import { describe, expect, it, vi } from "vitest";
import { createTransformRequestStore } from "./TransformRequestStore";
describe("Provider request transformer", () => {
	it("rejects invalid JSON locally and resets its pending state without making a request", async () => {
		const call = vi.fn();
		const store = createTransformRequestStore(call);
		store.state.request = "{invalid";
		await store.transform(true);
		expect(call).not.toHaveBeenCalled();
		expect(store.state.loading).toBe(false);
		expect(store.state.error).toBe("Invalid JSON in request body");
	});
	it("accepts the existing fallback response formats and reports backend failures without replacing prior output", async () => {
		const call = vi.fn().mockResolvedValueOnce("transformed example").mockRejectedValueOnce(new Error("Unavailable"));
		const store = createTransformRequestStore(call);
		await store.transform(true);
		expect(store.state.response).toBe("transformed example");
		await store.transform(true);
		expect(store.state.response).toBe("transformed example");
		expect(store.state.error).toBe("Failed to transform request");
		expect(store.state.loading).toBe(false);
	});
});
