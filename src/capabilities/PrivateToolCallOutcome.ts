import { ApiError } from "../core/api/ApiError";

/**
 * Outcome of one hidden-loop attempt to run a model-authored private tool call.
 *
 * `ok` carries the capability result; `argument_error` carries the tool result
 * text that replaces it when the model violated the private tool protocol.
 * @template T - capability result carried by the `ok` outcome
 */
export type PrivateToolCallOutcome<T> =
	| {
			/** The call matched the private tool protocol and ran to completion. */
			readonly status: "ok";
			/** Executed capability result. */
			readonly result: T;
	  }
	| {
			/** The call violated the private tool protocol and never reached the capability runtime. */
			readonly status: "argument_error";
			/** Tool result text returned to the model so it can correct the call. */
			readonly text: string;
	  };

/**
 * Runs one model-authored private tool call inside a hidden capability loop.
 *
 * Invalid arguments for a LiteLLM-injected tool are a model mistake, not a
 * client request error: the loop returns the problem as that tool call's result
 * so the model can correct itself in the next turn. Runtime failures (missing
 * worker model, upstream outage) still propagate and stay API errors.
 * @template T - capability result of one successful tool call
 * @param run - Execution of one private tool call.
 * @throws {ApiError} When the failure is not caused by the tool call arguments.
 */
export async function capturePrivateToolCallOutcome<T>(run: () => Promise<T>): Promise<PrivateToolCallOutcome<T>> {
	try {
		return { status: "ok", result: await run() };
	} catch (error) {
		if (!(error instanceof ApiError) || error.statusCode !== 400) {
			throw error;
		}
		return {
			status: "argument_error",
			text: `${error.message}。请修正该工具调用的参数后重新调用。`,
		};
	}
}
