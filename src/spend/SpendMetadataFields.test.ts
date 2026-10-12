import { projectSpendMetadata, validateSpendMetadataFields } from "./SpendMetadataFields";

describe("persisted SpendLogs metadata projection", () => {
	it("keeps status and cold-storage retrieval while leaving billing metadata intact", () => {
		const metadata = { status: "success", cold_storage_object_key: "object-1", cost_breakdown: { total_cost: 3 }, trace_id: "trace-1" };
		expect(projectSpendMetadata(metadata, { include: ["trace_id"] })).toEqual({
			status: "success",
			cold_storage_object_key: "object-1",
			trace_id: "trace-1",
		});
		expect(metadata.cost_breakdown.total_cost).toBe(3);
		expect(projectSpendMetadata(metadata, { exclude: ["status", "cold_storage_object_key", "trace_id"] })).toEqual({
			status: "success",
			cold_storage_object_key: "object-1",
			cost_breakdown: { total_cost: 3 },
		});
	});
	it.each([{ include: [], exclude: [] }, { include: "trace_id" }, { include: [12] }, { unsupported: true }])(
		"rejects malformed configuration %j",
		(config) => {
			expect(() => validateSpendMetadataFields(config)).toThrow();
		},
	);
});
