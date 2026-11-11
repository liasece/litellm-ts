import type { ImageCompletionAsset } from "../db/schema/imageCompletions";
import { ApiError } from "../core/api/ApiError";
import { MAX_BUILTIN_CAPABILITY_ITERATIONS } from "./BuiltinCapabilitiesConfig";
import type { BuiltinGeneratedImage } from "./ImageGenerationCapability";

/** Paid output positions in a verified task. Only artifacts produced by the current request are attached. */
export class ImageGenerationTargets {
	private _count?: number;
	private _imagesOnly = true;
	private _caption?: string;
	private readonly _previous = new Map<number, ImageCompletionAsset[]>();
	private readonly _outputs = new Map<number, BuiltinGeneratedImage[]>();

	/** @param previous - Previously paid slots verified against this public task by the history repository. */
	constructor(previous: readonly ImageCompletionAsset[] = []) {
		const count = previous[0]?.target?.count;
		if (
			typeof count !== "number" ||
			!Number.isInteger(count) ||
			count < 1 ||
			count > MAX_BUILTIN_CAPABILITY_ITERATIONS ||
			!previous.every(
				(asset) =>
					asset.target?.count === count &&
					Number.isInteger(asset.target.index) &&
					asset.target.index >= 1 &&
					asset.target.index <= count,
			)
		) {
			return;
		}
		this._count = count;
		for (const asset of previous) {
			const index = asset.target!.index;
			const images = this._previous.get(index) ?? [];
			images.push(asset);
			this._previous.set(index, images);
		}
	}

	/** @param input - Parsed private tool arguments before worker execution. */
	accepts(input: Record<string, unknown>): boolean {
		const index = typeof input.output_index === "number" ? input.output_index : 1;
		return this._count === undefined || (index <= this._count && !this._outputs.has(index) && !this._previous.has(index));
	}

	/**
	 * The first successful call fixes the count for this request. When the model issues
	 * multiple calls together, validate their common plan before charging for any of them.
	 * @param inputs - All private image calls proposed in the same assistant message.
	 */
	batchError(inputs: readonly Record<string, unknown>[]): string | undefined {
		if (this._count !== undefined || inputs.length < 2) {
			return undefined;
		}
		const count = inputs[0]?.output_count;
		const indexes = inputs.map((input) => input.output_index);
		const valid =
			typeof count === "number" &&
			Number.isInteger(count) &&
			count <= MAX_BUILTIN_CAPABILITY_ITERATIONS &&
			count >= inputs.length &&
			inputs.every((input) => input.output_count === count) &&
			indexes.every((index) => typeof index === "number" && Number.isInteger(index) && index >= 1 && index <= count) &&
			new Set(indexes).size === inputs.length;
		return valid
			? undefined
			: "No images were generated. For one requested image, make one call. For multiple requested images, use their total as output_count and assign each a distinct output_index from 1 through that total. Retry the requested outputs.";
	}

	/**
	 * Validate the requested output position before paying the worker.
	 * @param input - Parsed image tool arguments.
	 * @throws {ApiError} If a model supplies an invalid or inconsistent batch declaration.
	 */
	validate(input: Record<string, unknown>): { index: number; count: number } {
		const index = input.output_index ?? 1;
		const count = input.output_count ?? this._count ?? 1;
		if (
			typeof count !== "number" ||
			!Number.isInteger(count) ||
			count < 1 ||
			count > MAX_BUILTIN_CAPABILITY_ITERATIONS ||
			typeof index !== "number" ||
			!Number.isInteger(index) ||
			index < 1 ||
			index > count ||
			(this._count !== undefined && count !== this._count)
		) {
			throw ApiError.badRequest("Invalid image output_count or output_index for this request");
		}
		if (
			input.final_response === "image_and_caption" &&
			(count !== 1 ||
				typeof input.final_caption !== "string" ||
				!input.final_caption.trim() ||
				input.final_caption.length > 512 ||
				/(?:sha256:[a-f0-9]{64}|data:image\/)/iu.test(input.final_caption))
		) {
			throw ApiError.badRequest(
				"For image_and_caption, provide a short public final_caption for one requested image. Use continue for other work.",
			);
		}
		return { index: index, count: count };
	}

	/**
	 * The first successful output fixes the requested count. New tool IDs or reworded prompts
	 * cannot reopen a completed position.
	 * @param input - Validated model-authored position.
	 * @param images - Actual artifacts for that position.
	 */
	complete(input: Record<string, unknown>, images: BuiltinGeneratedImage[]): void {
		this._count ??= typeof input.output_count === "number" ? input.output_count : 1;
		this._imagesOnly &&= input.final_response === "images_only";
		if (input.final_response === "image_and_caption" && typeof input.final_caption === "string") {
			this._caption = input.final_caption;
		}
		this._outputs.set(typeof input.output_index === "number" ? input.output_index : 1, images);
	}

	/**
	 * Describe the paid target and unfinished work to the deciding model. The receipt belongs
	 * after its paired tool call, so later turns extend the same prefix.
	 * @param input - Output position requested by this tool call.
	 * @param status - Whether this call completed the target or attempted to repeat it.
	 */
	receipt(input: Record<string, unknown>, status: "completed" | "skipped"): string {
		const index = typeof input.output_index === "number" ? input.output_index : 1;
		const count = this._count ?? 1;
		const images = this._outputs.get(index) ?? this._previous.get(index) ?? [];
		const remaining = Array.from({ length: count }, (_, i) => i + 1).filter(
			(position) => !this._outputs.has(position) && !this._previous.has(position),
		);
		return JSON.stringify({
			status: status,
			action: images[0]?.action,
			images: images.map((image) => ({ ref: image.ref, media_type: image.mediaType })),
			output_index: index,
			output_count: count,
			remaining_output_indices: remaining,
			next_step: remaining.length
				? "Generate only the listed remaining outputs requested by the user."
				: this._previous.has(index) || (!this._outputs.size && this._previous.size > 0)
					? "This image was already returned as an API attachment for the same task. No workspace file is created. Use the existing result, finish the requested public work and reply in the requested format."
					: "All requested images are finished. The router attaches them as API output. It does not create a workspace file. Use filesystem tools only for an explicitly requested file operation. Return the requested caption or JSON, or leave text empty for an image-only reply. Keep internal references out of reply text.",
		});
	}

	/** Whether all explicitly declared deliverables have been generated. */
	get finished(): boolean {
		return this._count !== undefined && this._outputs.size + this._previous.size === this._count;
	}

	/** Ready after successful paid execution: null for attachments only, a supplied caption for text, otherwise continue the model. */
	get directReply(): string | null | undefined {
		if (!this.finished || this._outputs.size !== this._count) {
			return undefined;
		}
		return this._imagesOnly ? null : this._caption;
	}

	/** Public artifacts in the caller's declared order. */
	get images(): BuiltinGeneratedImage[] {
		return [...this._outputs.entries()].sort(([a], [b]) => a - b).flatMap(([, images]) => images);
	}
}
