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
		return normalized;
	}

	/** @inheritdoc */
	async get(ref: string): Promise<StoredVisionImage | undefined> {
		const contentHash = hashFromReference(ref);
		if (!contentHash) {
			return undefined;
		}
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
