import { afterEach, describe, it, expect, vi } from "vitest";
import { createVectorIngestStore } from "./VectorIngestStore";
import { vectorPayload, validateVectorFile, vectorIngestError } from "../logic/VectorDraftLogic";
describe("Vector store ingestion", () => {
	afterEach(() => vi.useRealTimers());
	it("reuses the first resulting vector store ID for all later uploads", async () => {
		vi.useFakeTimers();
		const ingest = vi
			.fn()
			.mockResolvedValueOnce({ vector_store_id: "vs-created", file_id: "file-a" })
			.mockResolvedValueOnce({ vector_store_id: "vs-created", file_id: "file-b" });
		const store = createVectorIngestStore(ingest);
		store.add([new File(["first"], "first.txt", { type: "text/plain" }), new File(["second"], "second.txt", { type: "text/plain" })]);
		await expect(store.create()).resolves.toBe("vs-created");
		expect(ingest.mock.calls.map((call) => call[2])).toEqual([undefined, "vs-created"]);
		expect(store.documents.value.map((doc) => doc.status)).toEqual(["done", "done"]);
		expect(store.results.value).toHaveLength(2);
		vi.advanceTimersByTime(3000);
		expect(store.documents.value).toHaveLength(0);
		store.dispose();
	});
	it("stops at the first failed file and keeps later files ready without reporting success", async () => {
		const ingest = vi.fn().mockRejectedValueOnce(new Error("synthetic upload failure"));
		const store = createVectorIngestStore(ingest);
		store.add([new File(["a"], "a.txt", { type: "text/plain" }), new File(["b"], "b.txt", { type: "text/plain" })]);
		await store.create();
		expect(ingest).toHaveBeenCalledTimes(1);
		expect(store.documents.value.map((doc) => doc.status)).toEqual(["error", "done"]);
		expect(store.state.pending).toBe(false);
		expect(store.results.value).toEqual([]);
		expect(store.state.message).toBe("");
		store.dispose();
	});
	it("rejects unsupported file types and missing provider settings before upload", () => {
		expect(validateVectorFile(new File(["x"], "x.exe", { type: "application/octet-stream" }))).toContain("not a supported file type");
		expect(
			vectorIngestError("s3_vectors", { vector_bucket_name: "ab", aws_region_name: "us-west-2", embedding_model: "embedding" }),
		).toBe("Vector bucket name must be at least 3 characters");
	});
	it("maps the Milvus embedding field only at registration and excludes ineffective credential fields from updates", () => {
		expect(
			JSON.parse(
				JSON.stringify(
					vectorPayload(
						{
							custom_llm_provider: "milvus",
							vector_store_id: "vs-a",
							api_key: "synthetic",
							api_base: "https://example.test",
							embedding_model: "embedding",
						},
						"{}",
					),
				),
			),
		).toEqual({
			vector_store_id: "vs-a",
			custom_llm_provider: "milvus",
			vector_store_metadata: {},
			litellm_params: { api_key: "synthetic", api_base: "https://example.test", litellm_embedding_model: "embedding" },
		});
		expect(
			vectorPayload({ custom_llm_provider: "bedrock", vector_store_id: "vs-a", litellm_credential_name: "example" }, "{}", true),
		).not.toHaveProperty("litellm_credential_name");
		expect(() => vectorPayload({ custom_llm_provider: "bedrock" }, "{invalid}")).toThrow();
	});
});
