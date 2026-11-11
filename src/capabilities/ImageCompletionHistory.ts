import { createHash, randomUUID } from "node:crypto";
import type { Request } from "express";
import { ApiError } from "../core/api/ApiError";
import type { DrizzleDb } from "../core/db/Database";
import type { ImageCompletionAsset } from "../db/schema/imageCompletions";
import { resolveRequestSessionGroupKey } from "../spend/sessionIdentity";
import { MAX_BUILTIN_CAPABILITY_ITERATIONS } from "./BuiltinCapabilitiesConfig";
import type { BuiltinGeneratedImage } from "./ImageGenerationCapability";
import {
	DatabaseImageHistoryRepository,
	type ImageAnchorHit,
	type ImageHistoryRepository,
	type ImageOperation,
} from "./ImageCompletionRepository";
import {
	describeImageTranscript,
	historyDigest,
	imageCompletionMessage,
	imageItemKey,
	type HistoryMessage,
	type ImageHistoryProtocol,
} from "./ImageCompletionTranscript";
import type { VisionImageStore } from "./VisionImageStore";

/** Existing contract of a successful private image worker execution. */
export interface ImageCompletionExecution {
	/** Worker usage and audit information. Empty for a previously paid result. */
	raw: Record<string, unknown>;
	/** Actual image executor. */
	model: string;
	/** Public artifacts created for this operation. */
	images: BuiltinGeneratedImage[];
}

/**
 * @param image - The generated artifact before public transport encoding.
 * @param target - Output position validated at execution time.
 */
function retainedAsset(image: BuiltinGeneratedImage, target?: ImageCompletionAsset["target"]): ImageCompletionAsset {
	const { b64Json: _bytes, prompt: _prompt, ...asset } = image;
	return target ? { ...asset, target: target } : asset;
}

/**
 * @param operation - A successfully completed execution of this exact request.
 * @param prompt - Current request prompt (never saved in the completion table).
 * @param store - Existing immutable image store.
 */
async function existingExecution(operation: ImageOperation, prompt: string, store: VisionImageStore): Promise<ImageCompletionExecution> {
	const images = await Promise.all(
		operation.assets.map(async (asset) => {
			const image = await store.get(asset.ref);
			if (!image) {
				throw ApiError.unavailable("The previously generated image could not be loaded");
			}
			const { target: _target, ...publicAsset } = asset;
			return { ...publicAsset, b64Json: image.base64Data, prompt: prompt };
		}),
	);
	if (!images.length) {
		throw ApiError.unavailable("The completed image operation has no artifact");
	}
	return {
		raw: {},
		model: images[0]!.model,
		images: images,
	};
}

/**
 * @param item - Native historical output carried by the client.
 * @param asset - Verified asset to which this scoped ID was issued.
 * @throws {ApiError} If supplied bytes contradict the issued artifact.
 */
function checkInlineImage(item: HistoryMessage, asset: ImageCompletionAsset): void {
	if (item.result === undefined || item.result === null) {
		return;
	}
	if (typeof item.result !== "string" || !/^[A-Za-z0-9+/=\s]+$/u.test(item.result)) {
		throw ApiError.badRequest("Invalid image_generation_call result");
	}
	const hash = createHash("sha256").update(Buffer.from(item.result, "base64")).digest("hex");
	if (asset.ref !== `sha256:${hash}`) {
		throw ApiError.badRequest("Image content does not match this image_generation_call");
	}
}

/**
 * Ambiguous or legacy plans still produce model-facing history. Only fixed
 * slots from identifiable, successful operations can suppress paid work.
 * @param operations - Operations bound to the same verified continuation chain.
 */
function continuingPlan(operations: Iterable<ImageOperation>): ImageCompletionAsset[] {
	const assets = new Map<string, ImageCompletionAsset>();
	const slotOwners = new Map<number, string>();
	let count: number | undefined;
	for (const operation of operations) {
		for (const asset of operation.assets) {
			const target = asset.target;
			if (
				!target ||
				!Number.isInteger(target.index) ||
				!Number.isInteger(target.count) ||
				target.index < 1 ||
				target.index > target.count ||
				target.count > MAX_BUILTIN_CAPABILITY_ITERATIONS ||
				(count !== undefined && target.count !== count)
			) {
				return [];
			}
			const owner = slotOwners.get(target.index);
			if (owner !== undefined && owner !== operation.id) {
				return [];
			}
			count = target.count;
			slotOwners.set(target.index, operation.id);
			assets.set(asset.id, asset);
		}
	}
	return [...assets.values()];
}

/** Per-request handle. Only the immutable public branch is used for persistence and lookup. */
export class ImageCompletionHistory {
	private readonly _operations = new Set<string>();
	private _sequence = 0;
	private _projection?: Promise<HistoryMessage[]>;
	private _requestHash?: string;
	private _continuingAssets: readonly ImageCompletionAsset[] = [];

	/** Verified paid positions for a public tool continuation. Never an attachment queue. */
	get continuingAssets(): readonly ImageCompletionAsset[] {
		return this._continuingAssets;
	}

	/**
	 * @param _repository - Persistence owned by the router.
	 * @param _request - Authenticated scope and unmodified public protocol data.
	 */
	constructor(
		private readonly _repository: ImageHistoryRepository,
		private readonly _request: {
			scope: string;
			protocol: ImageHistoryProtocol;
			messages: readonly HistoryMessage[];
			sessionKnown: boolean;
			idempotencyKey?: string;
			requestIdentity?: unknown;
		},
	) {}

	/** Returns a model-facing copy only when at least one immutable receipt belongs to this branch. */
	restore(): Promise<HistoryMessage[]> {
		this._projection ??= this._project();
		return this._projection;
	}

	/** Reconstruct the same append-only receipt at the same public boundary on every later turn. */
	private async _project(): Promise<HistoryMessage[]> {
		const raw = this._request.messages as HistoryMessage[];
		if (raw.some((m) => !m || typeof m !== "object")) {
			return raw;
		}
		if (!raw.some((m) => m.role === "assistant" || m.type === "function_call" || m.type === "image_generation_call")) {
			return raw;
		}
		if (!(await this._repository.hasHistory(this._request.scope))) {
			return raw;
		}
		const boundaries = describeImageTranscript(raw, this._request.sessionKnown, true);
		const keys = [...new Set(boundaries.flatMap((boundary) => boundary.keys))];
		const hits = await this._repository.find(this._request.scope, keys);
		if (!hits.length) {
			return raw;
		}
		const byAnchor = new Map<string, ImageAnchorHit[]>();
		for (const hit of hits) {
			const list = byAnchor.get(hit.anchor) ?? [];
			list.push(hit);
			byAnchor.set(hit.anchor, list);
		}
		const additions = new Map<number, HistoryMessage>();
		const omit = new Set<number>();
		const restored = new Set<string>();
		const continuing = new Map<string, ImageOperation>();
		let ambiguousContinuation = false;
		for (const boundary of boundaries) {
			if (boundary.after === undefined) {
				continue;
			}
			// An exact public reply can own several operations, but matching two different replies is ambiguous.
			const publicHits = boundary.keys.filter((key) => !key.startsWith("image:")).flatMap((key) => byAnchor.get(key) ?? []);
			const replies = new Set(publicHits.map((hit) => hit.replyId));
			if (boundary.continuesWithTools && publicHits.length) {
				if (replies.size === 1) {
					for (const { operation } of publicHits) {
						continuing.set(operation.id, operation);
					}
				} else {
					ambiguousContinuation = true;
				}
			}
			const verified = new Map<string, ImageCompletionAsset>();
			if (replies.size === 1) {
				for (const { operation } of publicHits) {
					for (const asset of operation.assets) {
						verified.set(asset.id, asset);
					}
				}
			}
			for (const { id, index } of boundary.images) {
				const owns = byAnchor.get(imageItemKey(id)) ?? [];
				const asset = owns.flatMap((hit) => hit.operation.assets).find((entry) => entry.id === id);
				if (!asset) {
					continue;
				}
				checkInlineImage(raw[index]!, asset);
				verified.set(asset.id, asset);
				omit.add(index);
			}
			const assets = [...verified.values()].filter((asset) => !restored.has(asset.id)).sort((a, b) => a.id.localeCompare(b.id));
			if (!assets.length) {
				continue;
			}
			for (const asset of assets) {
				restored.add(asset.id);
			}
			additions.set(boundary.after, imageCompletionMessage(this._request.protocol, assets));
		}
		this._continuingAssets = ambiguousContinuation ? [] : continuingPlan(continuing.values());
		if (!additions.size && !omit.size) {
			return raw;
		}
		const projected: HistoryMessage[] = [];
		for (const [index, message] of raw.entries()) {
			if (!omit.has(index)) {
				projected.push(message);
			}
			const receipt = additions.get(index);
			if (receipt) {
				projected.push(receipt);
			}
		}
		return projected;
	}

	/**
	 * Reserve before contacting the image worker and persist success before model continuation.
	 * @param toolCallId - Private tool call authored by the model.
	 * @param action - Requested operation.
	 * @param prompt - Current worker prompt.
	 * @param imageStore - Existing content-addressed bytes.
	 * @param generate - Executes the actual worker at most once for this reservation.
	 * @param position - One-based output index and total validated by the target tracker, stable across execution-order changes.
	 */
	async execute(
		toolCallId: string,
		action: "create" | "edit",
		prompt: string,
		imageStore: VisionImageStore,
		generate: () => Promise<ImageCompletionExecution>,
		...position: [outputIndex?: number, outputCount?: number]
	): Promise<ImageCompletionExecution> {
		const [outputIndex, outputCount] = position;
		const ordinal = outputIndex === undefined ? this._sequence++ : outputIndex - 1;
		const id = this._request.idempotencyKey
			? historyDigest([this._request.scope, this._request.idempotencyKey, ordinal])
			: randomUUID();
		const requestHash = this._request.idempotencyKey
			? (this._requestHash ??= historyDigest(this._request.requestIdentity ?? this._request.messages))
			: "";
		const existing = await this._repository.claim({
			id: id,
			scope: this._request.scope,
			requestHash: requestHash,
			toolCallId: toolCallId,
			action: action,
			status: "running",
		});
		if (existing) {
			if (existing.requestHash !== requestHash || existing.action !== action) {
				throw new ApiError(409, "Image idempotency key belongs to a different request");
			}
			if (existing.status !== "completed") {
				throw new ApiError(409, "Image operation is in progress or still needs reconciliation");
			}
			const replay = await existingExecution(existing, prompt, imageStore);
			this._operations.add(id);
			return replay;
		}
		try {
			const result = await generate();
			const target = outputIndex !== undefined && outputCount !== undefined ? { index: outputIndex, count: outputCount } : undefined;
			await this._repository.complete(
				this._request.scope,
				id,
				result.images.map((image) => retainedAsset(image, target)),
			);
			this._operations.add(id);
			return result;
		} catch (error) {
			// A still-running reservation also prevents a second executor if the database is unavailable.
			await this._repository.uncertain(this._request.scope, id).catch(() => undefined);
			throw error;
		}
	}

	/**
	 * Associate this request's successful operations with the final public reply. Restoring an old
	 * receipt never puts it back in the public attachment queue.
	 * @param assistant - Actual Chat/Messages assistant message, or actual Responses output items.
	 */
	async bind(assistant: HistoryMessage | readonly HistoryMessage[]): Promise<void> {
		if (!this._operations.size) {
			return;
		}
		const output: HistoryMessage[] = Array.isArray(assistant) ? assistant : [assistant];
		const boundaries = describeImageTranscript([...this._request.messages, ...output], this._request.sessionKnown);
		const keys = new Set<string>();
		for (const boundary of boundaries) {
			if (boundary.end < this._request.messages.length) {
				continue;
			}
			for (const key of boundary.keys) {
				if (!key.startsWith("image:")) {
					keys.add(key);
				}
			}
		}
		const ids = [...this._operations];
		if (keys.size) {
			await this._repository.bind(this._request.scope, [...keys], historyDigest(ids), ids);
		}
	}
}

/**
 * Create a request-owned handle without storing raw credentials or client-supplied identity as authorization.
 * @param db - Router database, if configured.
 * @param req - Authenticated downstream request.
 * @param protocol - Public protocol of this request.
 * @param publicHistory - Unmodified public messages.
 */
export function createImageCompletionHistory(
	db: DrizzleDb | undefined,
	req: Request,
	protocol: ImageHistoryProtocol,
	publicHistory: readonly HistoryMessage[],
): ImageCompletionHistory | undefined {
	const auth = req.auth;
	const credential = auth?.token || auth?.api_key;
	if (!db || !credential) {
		return undefined;
	}
	const session = resolveRequestSessionGroupKey(req);
	const scope = historyDigest([credential, auth?.user_id, auth?.team_id, auth?.organization_id, auth?.project_id, session]);
	const retry = req.headers?.["idempotency-key"];
	return new ImageCompletionHistory(new DatabaseImageHistoryRepository(db), {
		scope: scope,
		protocol: protocol,
		messages: publicHistory,
		sessionKnown: !!session,
		idempotencyKey: typeof retry === "string" && retry ? retry : undefined,
		requestIdentity: req.body,
	});
}
