import {
	MemoryVisionImageStore,
	storeVisionImageUrl,
	VISION_IMAGE_REFERENCE_PREFIX,
} from "./VisionImageStore";

describe("VisionImageStore", () => {
	it("uses the decoded bytes SHA-256 as a stable reference and canonicalizes base64", async () => {
		const store = new MemoryVisionImageStore();
		const first = await store.put({ mediaType: "image/png", base64Data: "abc" });
		const second = await store.put({ mediaType: "image/png", base64Data: "abc=" });

		expect(first.ref).toBe(`${VISION_IMAGE_REFERENCE_PREFIX}ce7c4f52106d5f03ccda1154a0af16baa95d222e354ca62e5f32e5e53e8180a7`);
		expect(second.ref).toBe(first.ref);
		expect(first.base64Data).toBe("abc=");
		expect(first.byteSize).toBe(2);
		await expect(store.get(first.ref)).resolves.toEqual(second);
	});

	it("downloads URL images and stores their bytes as base64", async () => {
		const store = new MemoryVisionImageStore();
		const fetchImpl = jest.fn(async () => new Response(Buffer.from("image-bytes"), { headers: { "content-type": "image/png" } }));

		const stored = await storeVisionImageUrl(store, "https://example.com/chart.png", fetchImpl as typeof fetch);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(stored.mediaType).toBe("image/png");
		expect(stored.base64Data).toBe(Buffer.from("image-bytes").toString("base64"));
		await expect(store.get(stored.ref)).resolves.toEqual(stored);
	});
});
