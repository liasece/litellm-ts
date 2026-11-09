import { createHash } from "node:crypto";
import {
	DatabaseVisionImageStore,
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

const IMAGE_BASE64 = Buffer.from("vision-image-bytes").toString("base64");
const IMAGE_HASH = createHash("sha256").update(Buffer.from(IMAGE_BASE64, "base64")).digest("hex");
const IMAGE_REF = `sha256:${IMAGE_HASH}`;

function createDb(rows: Array<Record<string, unknown>>): {
	db: never;
	selects: () => number;
	inserted: Array<Record<string, unknown>>;
} {
	let selects = 0;
	const inserted: Array<Record<string, unknown>> = [];
	const db = {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => {
						selects += 1;
						return rows;
					},
				}),
			}),
		}),
		insert: () => ({
			values: (values: Record<string, unknown>) => {
				inserted.push(values);
				return { onConflictDoNothing: async () => undefined };
			},
		}),
	};
	return { db: db as never, selects: () => selects, inserted: inserted };
}

describe("DatabaseVisionImageStore", () => {
	it("同一连接内重复读取走进程内副本，只查询一次数据库", async () => {
		const { db, selects } = createDb([{ contentHash: IMAGE_HASH, mediaType: "image/png", base64Data: IMAGE_BASE64, byteSize: 18 }]);
		const store = new DatabaseVisionImageStore(db);

		const first = await store.get(IMAGE_REF);
		const second = await store.get(IMAGE_REF);

		expect(first?.base64Data).toBe(IMAGE_BASE64);
		expect(second).toEqual(first);
		expect(selects()).toBe(1);
	});

	it("写入后的引用立即可读，不触发数据库查询", async () => {
		const { db, selects, inserted } = createDb([]);
		const store = new DatabaseVisionImageStore(db);

		const stored = await store.put({ mediaType: "image/png", base64Data: IMAGE_BASE64 });
		const loaded = await store.get(stored.ref);

		expect(stored.ref).toBe(IMAGE_REF);
		expect(loaded?.byteSize).toBe(18);
		expect(selects()).toBe(0);
		expect(inserted).toHaveLength(1);
	});

	it("未知引用返回 undefined 且不缓存失败结果", async () => {
		const { db, selects } = createDb([]);
		const store = new DatabaseVisionImageStore(db);

		await expect(store.get(IMAGE_REF)).resolves.toBeUndefined();
		await expect(store.get(IMAGE_REF)).resolves.toBeUndefined();
		expect(selects()).toBe(2);
	});
});
