import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_BuiltinCapabilityImages } from "../db/schema";
import { ApiError } from "../core/api/ApiError";

/** Prefix used to distinguish persisted content hashes from client paths. */
export const VISION_IMAGE_REFERENCE_PREFIX = "sha256:";

/** Canonical persisted representation of one image. */
export interface StoredVisionImage {
	/** Stable public-to-the-model reference derived from the image bytes. */
	readonly ref: string;
	/** Lowercase SHA-256 digest without the reference prefix. */
	readonly contentHash: string;
	/** MIME type sent to the vision-capable model. */
	readonly mediaType: string;
	/** Canonical base64 without a data-URL prefix. */
	readonly base64Data: string;
	/** Decoded byte count. */
	readonly byteSize: number;
}

/** Minimal content-addressed storage contract used by the vision executor. */
export interface VisionImageStore {
	/** Persist decoded image content and return its stable hash reference. */
	put(image: Omit<StoredVisionImage, "ref" | "contentHash" | "byteSize">): Promise<StoredVisionImage>;
	/** Load an image by a full `sha256:<digest>` reference. */
	get(ref: string): Promise<StoredVisionImage | undefined>;
}

function referenceForHash(contentHash: string): string {
	return `${VISION_IMAGE_REFERENCE_PREFIX}${contentHash}`;
}

function hashFromReference(ref: string): string | undefined {
	if (!ref.startsWith(VISION_IMAGE_REFERENCE_PREFIX)) {
		return undefined;
	}
	const hash = ref.slice(VISION_IMAGE_REFERENCE_PREFIX.length).toLowerCase();
	return /^[a-f0-9]{64}$/.test(hash) ? hash : undefined;
}

function normalizeImage(image: Omit<StoredVisionImage, "ref" | "contentHash" | "byteSize">): StoredVisionImage {
	const bytes = Buffer.from(image.base64Data, "base64");
	if (bytes.length === 0) {
		throw ApiError.badRequest("图片内容为空或不是有效 Base64");
	}
	const contentHash = createHash("sha256").update(bytes).digest("hex");
	return {
		ref: referenceForHash(contentHash),
		contentHash: contentHash,
		mediaType: image.mediaType,
		base64Data: bytes.toString("base64"),
		byteSize: bytes.length,
	};
}

/** 进程内图片副本上限（按 base64 字符数计）。 */
const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;
/** 单张图片超过该大小时不进入缓存，避免一张大图挤掉整个工作集。 */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/**
 * 图片引用 → 字节的进程内副本。
 *
 * 图片按内容哈希寻址且写入后不可变，因此副本不会过期；上限按总字节数淘汰最久未用的图片，
 * 避免把 1GB 量级的图片表整体拉进内存。并发读取同一引用时只向数据库装载一次。
 */
class VisionImageCache {
	private readonly _images = new Map<string, StoredVisionImage>();
	private readonly _inflight = new Map<string, Promise<StoredVisionImage | undefined>>();
	private readonly _maxBytes: number;
	private _bytes = 0;

	/** @param maxBytes - 副本总字节上限 */
	constructor(maxBytes: number) {
		this._maxBytes = maxBytes;
	}

	/**
	 * 读取图片，未命中时调用装载器并缓存结果。
	 * @param contentHash - 图片内容哈希
	 * @param load - 未命中时的数据库装载回调
	 */
	async getOrLoad(contentHash: string, load: () => Promise<StoredVisionImage | undefined>): Promise<StoredVisionImage | undefined> {
		const cached = this._images.get(contentHash);
		if (cached !== undefined) {
			this._images.delete(contentHash);
			this._images.set(contentHash, cached);
			return cached;
		}
		const pending = this._inflight.get(contentHash);
		if (pending !== undefined) {
			return await pending;
		}
		const task = load()
			.then((image) => {
				if (image !== undefined) {
					this.store(image);
				}
				return image;
			})
			.finally(() => {
				this._inflight.delete(contentHash);
			});
		this._inflight.set(contentHash, task);
		return await task;
	}

	/**
	 * 缓存一张图片，超出总上限时淘汰最久未使用的条目。
	 * @param image - 已完成归一化的图片
	 */
	store(image: StoredVisionImage): void {
		const size = image.base64Data.length;
		if (size > MAX_ENTRY_BYTES) {
			return;
		}
		const existing = this._images.get(image.contentHash);
		if (existing !== undefined) {
			this._bytes -= existing.base64Data.length;
			this._images.delete(image.contentHash);
		}
		this._images.set(image.contentHash, image);
		this._bytes += size;
		while (this._bytes > this._maxBytes && this._images.size > 0) {
			const oldest = this._images.keys().next();
			if (oldest.done === true) {
				break;
			}
			const evicted = this._images.get(oldest.value);
			this._images.delete(oldest.value);
			if (evicted !== undefined) {
				this._bytes -= evicted.base64Data.length;
			}
		}
	}
}

const imageCaches = new WeakMap<object, VisionImageCache>();

/** @returns 进程内副本的字节上限，可用 LITELLM_VISION_IMAGE_CACHE_BYTES 覆盖 */
function cacheLimitFromEnv(): number {
	const raw = process.env["LITELLM_VISION_IMAGE_CACHE_BYTES"];
	if (raw === undefined) {
		return DEFAULT_CACHE_BYTES;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_CACHE_BYTES;
}

/** @param db - 数据库连接，作为进程内副本的共享范围 */
function imageCacheFor(db: DrizzleDb): VisionImageCache {
	const key = db as unknown as object;
	const existing = imageCaches.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = new VisionImageCache(cacheLimitFromEnv());
	imageCaches.set(key, created);
	return created;
}

/** PostgreSQL-backed content-addressed image store. */
export class DatabaseVisionImageStore implements VisionImageStore {
	/** @param _db - Drizzle connection for the existing LiteLLM database. */
	constructor(private readonly _db: DrizzleDb) {}

	/** @inheritdoc */
	async put(image: Omit<StoredVisionImage, "ref" | "contentHash" | "byteSize">): Promise<StoredVisionImage> {
		const normalized = normalizeImage(image);
		await this._db
			.insert(liteLLM_BuiltinCapabilityImages)
			.values({
				contentHash: normalized.contentHash,
				mediaType: normalized.mediaType,
				base64Data: normalized.base64Data,
				byteSize: normalized.byteSize,
			})
			.onConflictDoNothing();
		imageCacheFor(this._db).store(normalized);
		return normalized;
	}

	/** @inheritdoc */
	async get(ref: string): Promise<StoredVisionImage | undefined> {
		const contentHash = hashFromReference(ref);
		if (!contentHash) {
			return undefined;
		}
		return await imageCacheFor(this._db).getOrLoad(contentHash, () => this._loadRow(contentHash));
	}

	private async _loadRow(contentHash: string): Promise<StoredVisionImage | undefined> {
		const rows = await this._db
			.select()
			.from(liteLLM_BuiltinCapabilityImages)
			.where(eq(liteLLM_BuiltinCapabilityImages.contentHash, contentHash))
			.limit(1);
		const row = rows[0];
		if (!row) {
			return undefined;
		}
		return {
			ref: referenceForHash(row.contentHash),
			contentHash: row.contentHash,
			mediaType: row.mediaType,
			base64Data: row.base64Data,
			byteSize: row.byteSize,
		};
	}
}

/** Request-local implementation used only when an endpoint has no database. */
export class MemoryVisionImageStore implements VisionImageStore {
	private readonly _images = new Map<string, StoredVisionImage>();

	/** @inheritdoc */
	async put(image: Omit<StoredVisionImage, "ref" | "contentHash" | "byteSize">): Promise<StoredVisionImage> {
		const normalized = normalizeImage(image);
		this._images.set(normalized.contentHash, normalized);
		return normalized;
	}

	/** @inheritdoc */
	async get(ref: string): Promise<StoredVisionImage | undefined> {
		const contentHash = hashFromReference(ref);
		return contentHash ? this._images.get(contentHash) : undefined;
	}
}

/**
 * Create the production database store or a request-local fallback.
 * @param db
 */
export function createVisionImageStore(db?: DrizzleDb): VisionImageStore {
	return db ? new DatabaseVisionImageStore(db) : new MemoryVisionImageStore();
}

function mediaTypeFromUrl(url: string): string {
	const pathname = new URL(url).pathname.toLowerCase();
	if (pathname.endsWith(".png")) {
		return "image/png";
	}
	if (pathname.endsWith(".webp")) {
		return "image/webp";
	}
	if (pathname.endsWith(".gif")) {
		return "image/gif";
	}
	if (pathname.endsWith(".avif")) {
		return "image/avif";
	}
	return "image/jpeg";
}

/**
 * Resolve an OpenAI-compatible image URL/data URL into canonical base64 and
 * persist it before the text-only model receives its content-hash reference.
 * @param store
 * @param url
 * @param fetchImpl
 */
export async function storeVisionImageUrl(
	store: VisionImageStore,
	url: string,
	fetchImpl: typeof fetch = fetch,
): Promise<StoredVisionImage> {
	if (url.startsWith("data:")) {
		const match = /^data:([^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/i.exec(url);
		if (!match) {
			throw ApiError.badRequest("图片 data URL 必须使用 Base64 编码");
		}
		const mediaType = match[1]!.toLowerCase();
		if (!mediaType.startsWith("image/")) {
			throw ApiError.badRequest(`图片 MIME 类型无效: ${mediaType}`);
		}
		return store.put({ mediaType: mediaType, base64Data: match[2]! });
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw ApiError.badRequest(`图片 URL 无效: ${url}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw ApiError.badRequest(`不支持的图片 URL 协议: ${parsed.protocol}`);
	}
	let response: Response;
	try {
		response = await fetchImpl(parsed);
	} catch (error) {
		throw ApiError.unavailable(`下载图片失败: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!response.ok) {
		throw ApiError.unavailable(`下载图片失败: HTTP ${response.status}`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	const responseType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
	const mediaType = responseType?.startsWith("image/") ? responseType : mediaTypeFromUrl(url);
	return store.put({ mediaType: mediaType, base64Data: bytes.toString("base64") });
}
