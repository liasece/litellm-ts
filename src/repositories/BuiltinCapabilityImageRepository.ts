/**
 * LiteLLM_BuiltinCapabilityImages 仓库 — 内容寻址图片字节的唯一访问点。
 *
 * 这张表按用户上传和生成逐行增长，单行就是一张图片（base64 文本可达数 MB），所以不存在
 * 「整表副本」这种用法；本仓库默认也不做按键缓存，读取一律落到数据库。上层
 * `DatabaseVisionImageStore` 仍然保留一个按字节总量封顶的不可变内容副本：图片按内容哈希
 * 寻址、写入后不会变化，副本不会过期；那是「同一请求内反复引用同一张图」的传输缓存，
 * 不是表缓存，缓存装载与写穿都由它自己负责。
 */
import { eq } from "drizzle-orm";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_BuiltinCapabilityImages } from "../db/schema/builtinCapabilityImages";
import { singletonFor } from "./internal/registry";

/** `LiteLLM_BuiltinCapabilityImages` 行。 */
export type BuiltinCapabilityImageRow = typeof liteLLM_BuiltinCapabilityImages.$inferSelect;

/** 写入一张图片所需的列（主键 content_hash 由解码后的字节算出）。 */
export interface BuiltinCapabilityImageInsert {
	/** 解码后字节的 SHA-256 十六进制摘要。 */
	readonly contentHash: string;
	/** 发送给视觉模型的 MIME 类型。 */
	readonly mediaType: string;
	/** 规范化的 base64（不含 data URL 前缀）。 */
	readonly base64Data: string;
	/** 解码后的字节数。 */
	readonly byteSize: number;
}

/**
 * 取得与数据库连接绑定的图片仓库。
 * @param db - Drizzle 数据库实例
 */
export const builtinCapabilityImageRepositoryFor = singletonFor((db: DrizzleDb) => new BuiltinCapabilityImageRepository(db));

/** 内容寻址图片仓库。 */
export class BuiltinCapabilityImageRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * 写入一张图片。
	 *
	 * 相同字节必须共用一行：content_hash 是主键，冲突时保持已存在的行，
	 * 调用方不需要先查再写，也不会因为同一张图被多个请求上传而失败。
	 * @param image - 已完成归一化的图片列
	 */
	async insertIfAbsent(image: BuiltinCapabilityImageInsert): Promise<void> {
		await this._db
			.insert(liteLLM_BuiltinCapabilityImages)
			.values({
				contentHash: image.contentHash,
				mediaType: image.mediaType,
				base64Data: image.base64Data,
				byteSize: image.byteSize,
			})
			.onConflictDoNothing();
	}

	/**
	 * 按内容哈希读取图片行。
	 * @param contentHash - 解码后字节的 SHA-256 十六进制摘要
	 * @returns 图片行；尚未写入时返回 undefined
	 */
	async findByContentHash(contentHash: string): Promise<BuiltinCapabilityImageRow | undefined> {
		const rows = await this._db
			.select()
			.from(liteLLM_BuiltinCapabilityImages)
			.where(eq(liteLLM_BuiltinCapabilityImages.contentHash, contentHash))
			.limit(1);
		return rows[0];
	}
}
