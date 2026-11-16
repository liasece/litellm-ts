import type { Response } from "express";

type Payload = Record<string, unknown>;

function record(value: unknown): Payload | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Payload) : undefined;
}

function nonempty(value: unknown): boolean {
	return typeof value === "string" && value.length > 0;
}

function messageUsage(usage: Payload): Payload {
	return {
		input_tokens: usage.input_tokens ?? 0,
		cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
		cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
		output_tokens: usage.output_tokens ?? 0,
	};
}

/**
 * A message envelope, empty block, token count or ping carries no model output.
 * @param payload - Downstream Anthropic SSE event.
 */
export function hasAnthropicContent(payload: Payload): boolean {
	if (payload.type === "content_block_start") {
		const block = record(payload.content_block);
		return !!block && (nonempty(block.text) || nonempty(block.thinking) || nonempty(block.data) || nonempty(block.name));
	}
	if (payload.type === "content_block_delta") {
		const delta = record(payload.delta);
		return (
			!!delta &&
			(nonempty(delta.text) ||
				nonempty(delta.thinking) ||
				nonempty(delta.partial_json) ||
				nonempty(delta.signature) ||
				delta.citation != null)
		);
	}
	return false;
}

/** One downstream Messages stream can span several private main-model turns. */
export class AnthropicCapabilityStream {
	private _started = false;
	private readonly _id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
	private readonly _published = new Set<Payload>();

	constructor(
		private readonly _res: Response,
		private readonly _model: string,
		private readonly _onFirstContent: () => void,
	) {}

	/** Number of committed public blocks, used to decide if a failed attempt can be replayed. */
	get publishedCount(): number {
		return this._published.size;
	}

	private _write(payload: Payload): void {
		if (this._res.destroyed || this._res.writableEnded) {
			throw new DOMException("Client disconnected during the Messages stream", "AbortError");
		}
		this._res.write(`event: ${String(payload.type)}\ndata: ${JSON.stringify(payload)}\n\n`);
		if (hasAnthropicContent(payload)) {
			this._onFirstContent();
		}
	}

	private _start(usage: Payload, images?: unknown[]): void {
		if (this._started) {
			return;
		}
		this._started = true;
		// The shared keepalive may have committed SSE headers while the model was thinking.
		if (!this._res.headersSent) {
			this._res.writeHead(200, {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Accel-Buffering": "no",
			});
		}
		this._write({
			type: "message_start",
			message: {
				id: this._id,
				type: "message",
				role: "assistant",
				model: this._model,
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { ...messageUsage(usage), output_tokens: 0 },
				...(images?.length ? { generated_images: images } : {}),
			},
		});
		if (images?.length) {
			this._onFirstContent();
		}
	}

	/**
	 * Forward leading text and thinking immediately. A later private tool can cause the capability
	 * loop to discard any sibling client tool calls. Hold those calls and the rest of their turn
	 * until the loop selects the public result, preserving block order and client ownership.
	 */
	beginAttempt(): (event: Payload, blocks: ReadonlyMap<number, Payload>, usage: Payload) => void {
		const pending = new Map<number, { start: Payload; source: Payload; index?: number }>();
		let deferRemaining = false;
		return (event, blocks, usage) => {
			if (event.type === "message_stop") {
				for (const block of pending.values()) {
					if (block.index !== undefined) {
						this._write({ type: "content_block_stop", index: block.index });
					}
				}
				pending.clear();
				return;
			}
			const index = event.index;
			if (typeof index !== "number") {
				return;
			}
			if (event.type === "content_block_start") {
				const source = blocks.get(index);
				if (source?.type !== "text" && source?.type !== "thinking" && source?.type !== "redacted_thinking") {
					deferRemaining = true;
				}
				if (deferRemaining || !source) {
					return;
				}
				pending.set(index, { start: event, source: source });
			}
			const block = pending.get(index);
			if (!block) {
				return;
			}
			if (block.index === undefined && hasAnthropicContent(event)) {
				this._start(usage);
				block.index = this._published.size;
				this._published.add(block.source);
				this._write({ ...block.start, index: block.index });
			}
			if (block.index !== undefined && event.type !== "content_block_start") {
				this._write({ ...event, index: block.index });
			}
			if (event.type === "content_block_stop") {
				pending.delete(index);
			}
		};
	}

	/**
	 * The log and continuation history must contain the same public blocks the client received.
	 * @param response - Public result selected by the capability loop.
	 */
	publicResponse(response: Payload): Payload {
		const final = Array.isArray(response.content) ? (response.content as Payload[]) : [];
		response.id = this._id;
		response.model = this._model;
		response.content = [...this._published, ...final.filter((block) => !this._published.has(block))];
		return response;
	}

	/**
	 * Write any remaining public blocks and one terminal event with total usage.
	 * @param response - Public result selected by the capability loop.
	 */
	finish(response: Payload): void {
		const usage = record(response.usage) ?? {};
		const images = Array.isArray(response.generated_images) && response.generated_images.length ? response.generated_images : undefined;
		const lateImages = this._started ? images : undefined;
		this._start(usage, images);
		const content = response.content as Payload[];
		for (let index = this._published.size; index < content.length; index++) {
			const block = content[index]!;
			if (block.type === "text") {
				this._write({ type: "content_block_start", index: index, content_block: { ...block, text: "" } });
				this._write({ type: "content_block_delta", index: index, delta: { type: "text_delta", text: block.text ?? "" } });
			} else if (block.type === "thinking") {
				this._write({ type: "content_block_start", index: index, content_block: { ...block, thinking: "", signature: "" } });
				this._write({
					type: "content_block_delta",
					index: index,
					delta: { type: "thinking_delta", thinking: block.thinking ?? "" },
				});
				if (nonempty(block.signature)) {
					this._write({
						type: "content_block_delta",
						index: index,
						delta: { type: "signature_delta", signature: block.signature },
					});
				}
			} else if (block.type === "tool_use") {
				this._write({ type: "content_block_start", index: index, content_block: { ...block, input: {} } });
				this._write({
					type: "content_block_delta",
					index: index,
					delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input ?? {}) },
				});
			} else {
				this._write({ type: "content_block_start", index: index, content_block: block });
			}
			this._write({ type: "content_block_stop", index: index });
		}
		this._write({
			type: "message_delta",
			delta: {
				stop_reason: response.stop_reason ?? "end_turn",
				stop_sequence: response.stop_sequence ?? null,
				...(lateImages ? { generated_images: lateImages } : {}),
			},
			usage: messageUsage(usage),
		});
		this._write({ type: "message_stop" });
	}
}
