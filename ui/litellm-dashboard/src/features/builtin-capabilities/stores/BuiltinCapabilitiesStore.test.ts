import { describe, expect, it, vi } from "vitest";
import { builtinCapabilitiesApi } from "../api/BuiltinCapabilitiesApi";
import { createBuiltinCapabilitiesStore } from "./BuiltinCapabilitiesStore";
import type { Capabilities } from "../support/BuiltinCapabilitiesModels";

type SaveResult = Awaited<ReturnType<typeof builtinCapabilitiesApi.save>>;

describe("built-in capability saves", () => {
	it("keeps the form usable and the edited values intact after a rejected update", async () => {
		let rejectSave!: (reason: unknown) => void;
		const save = vi.fn<typeof builtinCapabilitiesApi.save>(
			() =>
				new Promise<SaveResult>((_resolve, reject) => {
					rejectSave = reject;
				}),
		);
		const store = createBuiltinCapabilitiesStore({ ...builtinCapabilitiesApi, save });
		const capabilities: Capabilities = {
			vision: { enabled: false, always_inject: false, executors: [], max_iterations: 4, max_output_tokens: 32768 },
			image_generation: { enabled: false, always_inject: true, executors: [], max_iterations: 4, max_output_tokens: 32768 },
			web: { enabled: false, always_inject: false, executors: [], max_iterations: 4, max_output_tokens: 32768 },
		};
		store.state.capabilities = capabilities;
		const pending = store.save();
		await Promise.resolve();
		expect(store.state.saving).toBe(true);
		rejectSave(new Error("Synthetic save rejection"));
		await pending;
		expect(store.state.saving).toBe(false);
		expect(store.state.capabilities).toEqual(capabilities);
		store.dispose();
	});
});
