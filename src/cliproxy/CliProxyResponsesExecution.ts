const DEFAULT_CAPTURE_LIMIT = 2_000_000;

const RESPONSES_TERMINAL_EVENT_TYPES = new Set([
	"response.completed",
	"response.incomplete",
	"response.failed",
	"response.cancelled",
]);

/** Policy chosen when the client disconnects, based on the upstream output already observed. */
export type ResponsesCancellationStrategy =
	| "none"
	| "immediate_abort"
	| "terminal_tail_grace"
	| "text_terminal_tail_grace"
	| "post_output_drain";
/** HTTP lifecycle event that requested cancellation of the upstream execution. */
export type ResponsesCancellationSource = "unknown" | "request_aborted" | "response_closed";

/** Captured upstream progress retained independently of the client connection. */
export interface CliProxyResponsesExecutionSnapshot {
	/** Decoded upstream stream, bounded by the capture limit with its head and tail retained. */
	readonly raw: string;
	/** Receipt time of the first nonempty decoded chunk, or null before any data arrives. */
	readonly firstChunkAt: Date | null;
	/** Whether a client cancellation request has detached the downstream connection. */
	readonly clientDisconnected: boolean;
	/** Whether the execution has accepted a client cancellation request. */
	readonly cancellationRequested: boolean;
	/** Abort or drain policy selected when cancellation was requested. */
	readonly cancellationStrategy: ResponsesCancellationStrategy;
	/** HTTP event that initiated the accepted cancellation request. */
	readonly cancellationSource: ResponsesCancellationSource;
	/** Time of the first accepted cancellation request, or null if none was accepted. */
	readonly cancellationRequestedAt: Date | null;
	/** Whether the execution has aborted its upstream AbortSignal. */
	readonly upstreamAbortIssued: boolean;
	/** Time the upstream abort was issued, or null while it remains active. */
	readonly upstreamAbortIssuedAt: Date | null;
	/** Whether a text-done event or a completed message item has been observed. */
	readonly completedOutputReceived: boolean;
	/** Whether a completed, incomplete, failed or cancelled response event has been observed. */
	readonly terminalReceived: boolean;
	/** Receipt time of the first terminal response event. */
	readonly terminalReceivedAt: Date | null;
	/** Type of the most recently parsed SSE payload with a string type field. */
	readonly lastSseEventType?: string;
	/** Receipt time of the last recognized SSE payload. */
	readonly lastSseEventAt: Date | null;
	/** Total decoded UTF-16 code units received, including content omitted from raw. */
	readonly capturedCharacters: number;
	/** Whether the captured stream has exceeded the configured retention limit. */
	readonly capturedTruncated: boolean;
}

/** Drain deadlines and checkpoint callbacks for a single Responses execution. */
export interface CliProxyResponsesExecutionOptions {
	/** Delay before aborting after completed output or a terminal event during cancellation, in milliseconds. */
	readonly postOutputDrainTimeoutMs: number;
	/** Grace period after nontext output when the client cancels, in milliseconds. */
	readonly terminalTailGraceMs: number;
	/** Grace period after text output when the client cancels, in milliseconds. */
	readonly textTerminalTailGraceMs: number;
	/** Maximum retained stream size in UTF-16 code units before keeping only its head and tail. */
	readonly captureLimit?: number;
	/** Receives serialized progress checkpoints; completion waits for the checkpoint queue. */
	readonly onCheckpoint?: (snapshot: CliProxyResponsesExecutionSnapshot) => void | Promise<void>;
	/** Receives errors from checkpoint callbacks. */
	readonly onCheckpointError?: (error: unknown) => void;
}

function parseSseEvent(event: string): Record<string, unknown> | undefined {
	const data = event
		.split(/\r?\n/)
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).replace(/^ /, ""))
		.join("\n");
	if (!data) {
		return undefined;
	}
	try {
		const payload: unknown = JSON.parse(data);
		if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
			return undefined;
		}
		return payload as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function isCompletedClientOutputEvent(payload: Record<string, unknown>): boolean {
	const type = payload["type"];
	if (type === "response.output_text.done") {
		return true;
	}
	if (type !== "response.output_item.done") {
		return false;
	}
	const item = payload["item"];
	return typeof item === "object" && item !== null && !Array.isArray(item) && (item as Record<string, unknown>)["type"] === "message";
}

/**
 * A Responses request is owned by this execution object instead of the Express
 * response. The HTTP adapter may detach at any time and only submits a
 * cancellation request; the execution retains captured upstream state until
 * logging and reservation finalization have finished.
 */
export class CliProxyResponsesExecution {
	private readonly _abortController = new AbortController();
	private readonly _postOutputDrainTimeoutMs: number;
	private readonly _terminalTailGraceMs: number;
	private readonly _textTerminalTailGraceMs: number;
	private readonly _captureLimit: number;
	private readonly _onCheckpoint?: (snapshot: CliProxyResponsesExecutionSnapshot) => void | Promise<void>;
	private readonly _onCheckpointError?: (error: unknown) => void;
	private _raw = "";
	private _pendingSse = "";
	private _firstChunkAt: Date | null = null;
	private _clientDisconnected = false;
	private _cancellationRequested = false;
	private _cancellationStrategy: ResponsesCancellationStrategy = "none";
	private _cancellationSource: ResponsesCancellationSource = "unknown";
	private _cancellationRequestedAt: Date | null = null;
	private _upstreamAbortIssued = false;
	private _upstreamAbortIssuedAt: Date | null = null;
	private _outputObserved = false;
	private _textOutputObserved = false;
	private _completedOutputReceived = false;
	private _terminalReceived = false;
	private _terminalReceivedAt: Date | null = null;
	private _lastSseEventType: string | undefined;
	private _lastSseEventAt: Date | null = null;
	private _capturedCharacters = 0;
	private _capturedTruncated = false;
	private _abortTimeout: ReturnType<typeof setTimeout> | undefined;
	private _checkpointTail: Promise<void> = Promise.resolve();
	private _completion: Promise<unknown> | undefined;
	private _finished = false;

	constructor(options: CliProxyResponsesExecutionOptions) {
		this._postOutputDrainTimeoutMs = options.postOutputDrainTimeoutMs;
		this._terminalTailGraceMs = options.terminalTailGraceMs;
		this._textTerminalTailGraceMs = options.textTerminalTailGraceMs;
		this._captureLimit = options.captureLimit ?? DEFAULT_CAPTURE_LIMIT;
		this._onCheckpoint = options.onCheckpoint;
		this._onCheckpointError = options.onCheckpointError;
	}

	/** Signal used by the upstream request; client disconnects follow the configured drain policy. */
	get signal(): AbortSignal {
		return this._abortController.signal;
	}

	/** Read the current captured state without transferring ownership of the execution. */
	get snapshot(): CliProxyResponsesExecutionSnapshot {
		return {
			raw: this._raw,
			firstChunkAt: this._firstChunkAt,
			clientDisconnected: this._clientDisconnected,
			cancellationRequested: this._cancellationRequested,
			cancellationStrategy: this._cancellationStrategy,
			cancellationSource: this._cancellationSource,
			cancellationRequestedAt: this._cancellationRequestedAt,
			upstreamAbortIssued: this._upstreamAbortIssued,
			upstreamAbortIssuedAt: this._upstreamAbortIssuedAt,
			completedOutputReceived: this._completedOutputReceived,
			terminalReceived: this._terminalReceived,
			terminalReceivedAt: this._terminalReceivedAt,
			lastSseEventType: this._lastSseEventType,
			lastSseEventAt: this._lastSseEventAt,
			capturedCharacters: this._capturedCharacters,
			capturedTruncated: this._capturedTruncated,
		};
	}

	/**
	 * Run one upstream operation and wait for queued checkpoints before settling.
	 * @param operation - Work that uses this execution to record upstream progress.
	 * @throws {Error} If the execution has already been started.
	 */
	start<T>(operation: (execution: CliProxyResponsesExecution) => Promise<T>): Promise<T> {
		if (this._completion) {
			throw new Error("CLIProxy Responses execution already started");
		}
		const completion = operation(this).finally(async () => {
			this._finished = true;
			if (this._abortTimeout !== undefined) {
				clearTimeout(this._abortTimeout);
			}
			await this.flushCheckpoints();
		});
		this._completion = completion;
		return completion;
	}

	/**
	 * Capture decoded data and advance SSE progress across chunk boundaries.
	 * @param chunk - Decoded upstream text; empty chunks are ignored.
	 * @param receivedAt - Receipt time shared by all events completed in this chunk.
	 */
	recordDecodedChunk(chunk: string, receivedAt: Date = new Date()): void {
		if (!chunk) {
			return;
		}
		this._firstChunkAt ??= receivedAt;
		this._capturedCharacters += chunk.length;
		this._raw += chunk;
		if (this._raw.length > this._captureLimit) {
			const half = Math.floor(this._captureLimit / 2);
			this._raw = `${this._raw.slice(0, half)}\n\n${this._raw.slice(-half)}`;
			this._capturedTruncated = true;
		}

		this._pendingSse += chunk;
		let shouldCheckpoint = false;
		while (true) {
			const boundary = /\r?\n\r?\n/.exec(this._pendingSse);
			if (!boundary) {
				break;
			}
			const event = this._pendingSse.slice(0, boundary.index);
			this._pendingSse = this._pendingSse.slice(boundary.index + boundary[0].length);
			const payload = parseSseEvent(event);
			const type = payload?.["type"];
			if (!payload || typeof type !== "string") {
				continue;
			}
			const firstEvent = this._lastSseEventType === undefined;
			this._lastSseEventType = type;
			this._lastSseEventAt = receivedAt;
			const firstOutputEvent = !this._outputObserved && type.startsWith("response.output_");
			this._outputObserved ||= type.startsWith("response.output_");
			this._textOutputObserved ||= type === "response.output_text.delta" || type === "response.output_text.done";
			const outputDone = isCompletedClientOutputEvent(payload);
			const terminal = RESPONSES_TERMINAL_EVENT_TYPES.has(type);
			this._completedOutputReceived ||= outputDone;
			if (terminal && !this._terminalReceived) {
				this._terminalReceived = true;
				this._terminalReceivedAt = receivedAt;
			}
			if (this._cancellationRequested && (outputDone || terminal)) {
				this._scheduleAbort(this._postOutputDrainTimeoutMs);
			}
			shouldCheckpoint ||= firstEvent || firstOutputEvent || outputDone || terminal;
		}
		if (shouldCheckpoint) {
			this._queueCheckpoint();
		}
	}

	/**
	 * Accept the first client disconnect and select an abort or drain deadline.
	 * @param source - HTTP lifecycle event that triggered cancellation.
	 * @param requestedAt - Time of the client cancellation request.
	 */
	requestClientCancellation(source: ResponsesCancellationSource = "unknown", requestedAt: Date = new Date()): void {
		if (this._finished || this._cancellationRequested) {
			return;
		}
		this._clientDisconnected = true;
		this._cancellationRequested = true;
		this._cancellationSource = source;
		this._cancellationRequestedAt = requestedAt;
		if (this._completedOutputReceived || this._terminalReceived) {
			this._cancellationStrategy = "post_output_drain";
			this._scheduleAbort(this._postOutputDrainTimeoutMs);
		} else if (this._textOutputObserved) {
			this._cancellationStrategy = "text_terminal_tail_grace";
			this._scheduleAbort(this._textTerminalTailGraceMs);
		} else if (this._outputObserved) {
			this._cancellationStrategy = "terminal_tail_grace";
			this._scheduleAbort(this._terminalTailGraceMs);
		} else {
			this._cancellationStrategy = "immediate_abort";
			this._abortUpstream(requestedAt);
		}
		this._queueCheckpoint();
	}

	/** Wait until the currently queued checkpoint callbacks have settled. */
	async flushCheckpoints(): Promise<void> {
		await this._checkpointTail;
	}

	private _scheduleAbort(timeoutMs: number): void {
		if (this._abortTimeout !== undefined) {
			clearTimeout(this._abortTimeout);
		}
		this._abortTimeout = setTimeout(() => this._abortUpstream(), timeoutMs);
		this._abortTimeout.unref();
	}

	private _abortUpstream(abortedAt: Date = new Date()): void {
		if (this._upstreamAbortIssued || this._finished) {
			return;
		}
		this._upstreamAbortIssued = true;
		this._upstreamAbortIssuedAt = abortedAt;
		this._abortController.abort();
		this._queueCheckpoint();
	}

	private _queueCheckpoint(): void {
		if (!this._onCheckpoint) {
			return;
		}
		const snapshot = this.snapshot;
		this._checkpointTail = this._checkpointTail
			.then(() => this._onCheckpoint?.(snapshot))
			.then(() => undefined)
			.catch((error: unknown) => {
				this._onCheckpointError?.(error);
			});
	}
}
