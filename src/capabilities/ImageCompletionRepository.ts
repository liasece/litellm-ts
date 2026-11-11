import { and, eq, sql } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import {
	imageCompletionAnchors as anchors,
	imageCompletions as completions,
	type ImageCompletionAsset,
} from "../db/schema/imageCompletions";
import { imageItemKey } from "./ImageCompletionTranscript";

/** Stored state of one image execution, including immutable output references. */
export type ImageOperation = typeof completions.$inferSelect;

/** An index hit contains only verified completed outputs. */
export interface ImageAnchorHit {
	/** Lookup key of the historical public event. */
	anchor: string;
	/** Disambiguates replies that happened to have the same public content. */
	replyId: string;
	/** Durable image operation referenced by the reply. */
	operation: ImageOperation;
}

/** The store is scoped on every read, including replay by native public image ID. */
export interface ImageHistoryRepository {
	/** Cheap indexed check before hashing a long conversation that never generated an image. */
	hasHistory(scope: string): Promise<boolean>;
	/** Batch lookup for one public transcript. */
	find(scope: string, keys: string[]): Promise<ImageAnchorHit[]>;
	/** Atomically reserve an operation. A conflict returns its existing state. */
	claim(value: typeof completions.$inferInsert): Promise<ImageOperation | undefined>;
	/** Store immutable metadata and publish all native image ID anchors in one transaction. */
	complete(scope: string, id: string, assets: ImageCompletionAsset[]): Promise<void>;
	/** An executor may already have produced an image. Preserve the reservation on uncertain failure. */
	uncertain(scope: string, id: string): Promise<void>;
	/** Bind verified operations to the public reply before the client can continue. */
	bind(scope: string, keys: string[], replyId: string, ids: string[]): Promise<void>;
}

/**
 * 「该 scope 没有图片历史」的负结果缓存有效期（毫秒，0 表示关闭）。
 *
 * hasHistory 是索引点查，但每个会话轮次都要一次往返，而绝大多数会话从未生成过图片。
 * 只缓存查不到的结果；写入侧（complete/bind）在本进程内立即失效，单进程内与逐次查询等价。
 * 多进程部署时，另一进程新写入的锚点最多延后一个 TTL 才对这里可见，因此 TTL 保持秒级。
 */
const NO_HISTORY_TTL_MS = Number(process.env.IMAGE_HISTORY_NO_HISTORY_TTL_MS ?? 60_000);
/** scope → 负结果到期时刻。 */
const noHistoryUntil = new Map<string, number>();
/** 缓存条目上限；超过后先清理过期项，避免长尾 session 让表无限增长。 */
const NO_HISTORY_MAX_ENTRIES = 512;

/**
 * 清除某个 scope 的负结果缓存；写入图片历史后必须调用。
 * @param scope - 图片历史作用域
 */
function forgetNoHistory(scope: string): void {
	noHistoryUntil.delete(scope);
}

/** 清空负结果缓存；仅供测试使用。 */
export function resetImageHistoryNegativeCache(): void {
	noHistoryUntil.clear();
}

/** PostgreSQL repository. Public history and image bytes never go into its indexes. */
export class DatabaseImageHistoryRepository implements ImageHistoryRepository {
	/** @param _db - The routing service database. */
	constructor(private readonly _db: DrizzleDb) {}

	/** @inheritdoc */
	async hasHistory(scope: string): Promise<boolean> {
		const now = Date.now();
		const cachedUntil = noHistoryUntil.get(scope);
		if (cachedUntil !== undefined) {
			if (cachedUntil > now) {
				return false;
			}
			noHistoryUntil.delete(scope);
		}
		const rows = await this._db.select({ anchor: anchors.anchor }).from(anchors).where(eq(anchors.scope, scope)).limit(1);
		if (rows.length > 0) {
			forgetNoHistory(scope);
			return true;
		}
		if (NO_HISTORY_TTL_MS > 0) {
			if (noHistoryUntil.size >= NO_HISTORY_MAX_ENTRIES) {
				for (const [key, until] of noHistoryUntil) {
					if (until <= now) {
						noHistoryUntil.delete(key);
					}
				}
			}
			noHistoryUntil.set(scope, now + NO_HISTORY_TTL_MS);
		}
		return false;
	}

	/** @inheritdoc */
	async find(scope: string, keys: string[]): Promise<ImageAnchorHit[]> {
		if (!keys.length) {
			return [];
		}
		return this._db
			.select({ anchor: anchors.anchor, replyId: anchors.replyId, operation: completions })
			.from(anchors)
			.innerJoin(completions, and(eq(anchors.operationId, completions.id), eq(anchors.scope, completions.scope)))
			.where(
				and(
					eq(anchors.scope, scope),
					sql`${anchors.anchor} = ANY(${sql.param(keys)}::text[])`,
					eq(completions.status, "completed"),
				),
			);
	}

	/** @inheritdoc */
	async claim(value: typeof completions.$inferInsert): Promise<ImageOperation | undefined> {
		const inserted = await this._db.insert(completions).values(value).onConflictDoNothing().returning({ id: completions.id });
		if (inserted.length) {
			return undefined;
		}
		const [prior] = await this._db
			.select()
			.from(completions)
			.where(and(eq(completions.scope, value.scope), eq(completions.id, value.id)))
			.limit(1);
		if (!prior) {
			throw new Error("Image operation reservation could not be read");
		}
		return prior;
	}

	/** @inheritdoc */
	async complete(scope: string, id: string, assets: ImageCompletionAsset[]): Promise<void> {
		await this._db.transaction(async (tx) => {
			await tx
				.update(completions)
				.set({ status: "completed", assets: assets })
				.where(and(eq(completions.id, id), eq(completions.scope, scope)));
			await tx
				.insert(anchors)
				.values(assets.map((asset) => ({ scope: scope, anchor: imageItemKey(asset.id), operationId: id, replyId: id })))
				.onConflictDoNothing();
		});
		forgetNoHistory(scope);
	}

	/** @inheritdoc */
	async uncertain(scope: string, id: string): Promise<void> {
		await this._db
			.update(completions)
			.set({ status: "unknown" })
			.where(and(eq(completions.id, id), eq(completions.scope, scope), eq(completions.status, "running")));
	}

	/** @inheritdoc */
	async bind(scope: string, keys: string[], replyId: string, ids: string[]): Promise<void> {
		const bindings = keys.flatMap((anchor) =>
			ids.map((operationId) => ({ scope: scope, anchor: anchor, replyId: replyId, operationId: operationId })),
		);
		if (bindings.length) {
			await this._db.insert(anchors).values(bindings).onConflictDoNothing();
			forgetNoHistory(scope);
		}
	}
}
