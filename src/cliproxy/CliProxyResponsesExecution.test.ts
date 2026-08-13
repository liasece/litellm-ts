import { CliProxyResponsesExecution } from "./CliProxyResponsesExecution";

describe("CliProxyResponsesExecution cancellation policy", () => {
	it("immediately aborts when the client disconnects before any model output", () => {
		const execution = new CliProxyResponsesExecution({
			postOutputDrainTimeoutMs: 50,
			terminalTailGraceMs: 10,
			textTerminalTailGraceMs: 30,
		});

		execution.requestClientCancellation("request_aborted");

		expect(execution.snapshot.cancellationStrategy).toBe("immediate_abort");
		expect(execution.snapshot.cancellationSource).toBe("request_aborted");
		expect(execution.snapshot.upstreamAbortIssued).toBe(true);
		expect(execution.snapshot.cancellationRequestedAt).toBeInstanceOf(Date);
		expect(execution.snapshot.upstreamAbortIssuedAt).toEqual(execution.snapshot.cancellationRequestedAt);
		expect(execution.signal.aborted).toBe(true);
	});

	it("does not treat an intermediate reasoning done event as completed client output", async () => {
		const execution = new CliProxyResponsesExecution({
			postOutputDrainTimeoutMs: 50,
			terminalTailGraceMs: 10,
			textTerminalTailGraceMs: 30,
		});
		execution.recordDecodedChunk(
			'event: response.reasoning_summary_text.done\ndata: {"type":"response.reasoning_summary_text.done","text":"summary"}\n\n' +
				'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"reasoning","id":"reasoning_1"}}\n\n',
		);

		execution.requestClientCancellation("response_closed");

		expect(execution.snapshot.completedOutputReceived).toBe(false);
		expect(execution.snapshot.cancellationStrategy).toBe("terminal_tail_grace");
		expect(execution.snapshot.cancellationSource).toBe("response_closed");
		expect(execution.snapshot.upstreamAbortIssued).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(execution.snapshot.upstreamAbortIssued).toBe(true);
		expect(execution.signal.aborted).toBe(true);
	});

	it("keeps a terminal already in flight during the short disconnect grace", async () => {
		const execution = new CliProxyResponsesExecution({
			postOutputDrainTimeoutMs: 50,
			terminalTailGraceMs: 10,
			textTerminalTailGraceMs: 40,
		});
		let releaseTerminal!: () => void;
		const terminalReady = new Promise<void>((resolve) => {
			releaseTerminal = resolve;
		});
		const completion = execution.start(async (work) => {
			await terminalReady;
			work.recordDecodedChunk(
				'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_1","status":"completed"}}\n\n',
			);
		});

		execution.recordDecodedChunk(
			'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello"}\n\n',
		);
		execution.requestClientCancellation("response_closed");
		expect(execution.snapshot.cancellationStrategy).toBe("text_terminal_tail_grace");
		releaseTerminal();
		await completion;

		expect(execution.snapshot.terminalReceived).toBe(true);
		expect(execution.snapshot.terminalReceivedAt).toBeInstanceOf(Date);
		expect(execution.snapshot.lastSseEventAt).toEqual(execution.snapshot.terminalReceivedAt);
		expect(execution.snapshot.upstreamAbortIssued).toBe(false);
	});

	it("gives text output a longer bounded terminal-tail grace than intermediate output", async () => {
		const execution = new CliProxyResponsesExecution({
			postOutputDrainTimeoutMs: 80,
			terminalTailGraceMs: 5,
			textTerminalTailGraceMs: 40,
		});
		execution.recordDecodedChunk(
			'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"complete-looking text"}\n\n',
		);

		execution.requestClientCancellation("response_closed");

		expect(execution.snapshot.cancellationStrategy).toBe("text_terminal_tail_grace");
		await new Promise((resolve) => setTimeout(resolve, 15));
		expect(execution.snapshot.upstreamAbortIssued).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(execution.snapshot.upstreamAbortIssued).toBe(true);
		expect(execution.signal.aborted).toBe(true);
	});

	it("extends an active text-tail deadline when completed output arrives after disconnect", async () => {
		const execution = new CliProxyResponsesExecution({
			postOutputDrainTimeoutMs: 45,
			terminalTailGraceMs: 5,
			textTerminalTailGraceMs: 15,
		});
		execution.recordDecodedChunk(
			'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hello"}\n\n',
		);
		execution.requestClientCancellation("response_closed");
		await new Promise((resolve) => setTimeout(resolve, 5));
		execution.recordDecodedChunk(
			'event: response.output_text.done\ndata: {"type":"response.output_text.done","text":"hello"}\n\n',
		);

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(execution.snapshot.completedOutputReceived).toBe(true);
		expect(execution.snapshot.upstreamAbortIssued).toBe(false);
		await new Promise((resolve) => setTimeout(resolve, 35));
		expect(execution.snapshot.upstreamAbortIssued).toBe(true);
	});

	it("hard-aborts a detached execution when the post-output drain deadline expires", async () => {
		const execution = new CliProxyResponsesExecution({
			postOutputDrainTimeoutMs: 10,
			terminalTailGraceMs: 5,
			textTerminalTailGraceMs: 20,
		});
		let aborted = false;
		const completion = execution.start(
			(work) =>
				new Promise<void>((resolve) => {
					work.signal.addEventListener(
						"abort",
						() => {
							aborted = true;
							resolve();
						},
						{ once: true },
					);
				}),
		);

		execution.recordDecodedChunk(
			'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"message","status":"completed","id":"msg_1"}}\n\n',
		);
		execution.requestClientCancellation();

		expect(aborted).toBe(false);
		expect(execution.snapshot.cancellationStrategy).toBe("post_output_drain");
		await completion;
		expect(aborted).toBe(true);
		expect(execution.snapshot.upstreamAbortIssued).toBe(true);
	});
});
