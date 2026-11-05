/**
 * DeepSeek 原生 Responses 的思考模式推理回显补齐。
 *
 * 官方契约：请求携带 tools 时，历史推理必须通过 reasoning item 的
 * content[].reasoning_text 回显，否则返回 400
 * `The \`reasoning_text\` in the thinking mode must be passed back to the API`。
 *
 * 2026-11-05 用生产 deepseek-v4-flash 组做了 31 次探测，实际校验范围比文档窄：
 * 1. 只有请求停在工具循环里（input 末项是 function_call_output）才校验；末尾再跟一条
 *    user 消息就不会触发；
 * 2. 只校验当前轮——最后一条 user/system/developer 之后的每个工具调用段，历史轮次缺失不影响；
 * 3. 段内必须存在 content[].reasoning_text 为非空字符串的 reasoning item；空 content、
 *    空字符串、仅 summary 全部仍然 400；
 * 4. reasoning item 必须位于对应 function_call 之前，插到其后会变成
 *    `No tool output found for tool call`。
 *
 * 跨上游 fallback（CLIProxy/CommandCode → 官方端点）会把历史整体搬过去，而其中大量回合由
 * 前者产生、本来就没有推理。这里只补结构占位，正文用固定标记，不伪造思考内容。
 */

/** 占位正文；固定常量保证同一份历史反复改写后字节一致，不破坏上下文缓存前缀。 */
export const DEEPSEEK_REASONING_PLACEHOLDER = "(reasoning omitted)";

/** user/system/developer 消息构成一轮的边界，校验不跨越它。 */
const TURN_BOUNDARY_ROLES = new Set(["user", "system", "developer"]);

/** 需要推理回显的调用项。 */
const TOOL_CALL_TYPES = new Set(["function_call", "custom_tool_call"]);

/** 工具结果项；它结束当前段。 */
const TOOL_OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRoleIn(item: Record<string, unknown>, roles: Set<string>): boolean {
	const role = item["role"];
	return typeof role === "string" && roles.has(role);
}

function hasTypeIn(item: Record<string, unknown>, types: Set<string>): boolean {
	const type = item["type"];
	return typeof type === "string" && types.has(type);
}

/**
 * reasoning item 是否带有上游认可的非空纯文本。
 * @param item - 待检查的 input item
 */
function hasReasoningText(item: Record<string, unknown>): boolean {
	const content = item["content"];
	if (!Array.isArray(content)) {
		return false;
	}
	return content.some(
		(part) => isRecord(part) && part["type"] === "reasoning_text" && typeof part["text"] === "string" && part["text"].length > 0,
	);
}

/**
 * 思考模式已关闭时不存在回显要求，不必改写请求体。
 * @param reasoning - 请求体的 reasoning 配置
 */
function isThinkingDisabled(reasoning: unknown): boolean {
	return isRecord(reasoning) && reasoning["effort"] === "none";
}

/**
 * 为停在工具循环里的 DeepSeek Responses 请求补齐当前轮的推理回显。
 *
 * 返回同一个对象表示无需改写（不产生任何字节变化）；需要补位时返回浅拷贝，
 * 只替换 input，不修改调用方传入的数组。
 * @param body - 已构造好的原生 Responses 请求体
 * @param placeholderText - 占位正文
 */
export function backfillDeepSeekResponsesReasoning(
	body: Record<string, unknown>,
	placeholderText: string = DEEPSEEK_REASONING_PLACEHOLDER,
): Record<string, unknown> {
	const input = body["input"];
	if (!Array.isArray(input) || input.length === 0) {
		return body;
	}
	const tools = body["tools"];
	if (!Array.isArray(tools) || tools.length === 0) {
		return body;
	}
	const lastItem: unknown = input[input.length - 1];
	if (!isRecord(lastItem) || !hasTypeIn(lastItem, TOOL_OUTPUT_TYPES)) {
		return body;
	}
	if (isThinkingDisabled(body["reasoning"])) {
		return body;
	}

	// 只处理当前轮：校验不跨越最后一条 user/system/developer。
	let turnStart = 0;
	for (let index = input.length - 1; index >= 0; index--) {
		const item: unknown = input[index];
		if (isRecord(item) && hasRoleIn(item, TURN_BOUNDARY_ROLES)) {
			turnStart = index + 1;
			break;
		}
	}

	// 一段 = 一次 assistant 工具调用及其结果；逐段判定是否已经带回推理。
	const insertBefore: number[] = [];
	let roundFirstCall = -1;
	let roundHasReasoningText = false;
	const closeRound = (): void => {
		if (roundFirstCall >= 0 && !roundHasReasoningText) {
			insertBefore.push(roundFirstCall);
		}
		roundFirstCall = -1;
		roundHasReasoningText = false;
	};
	for (let index = turnStart; index < input.length; index++) {
		const item: unknown = input[index];
		if (!isRecord(item)) {
			continue;
		}
		if (hasRoleIn(item, TURN_BOUNDARY_ROLES)) {
			closeRound();
			continue;
		}
		if (item["type"] === "reasoning") {
			// 只有位于该段首个调用之前的非空推理才算回显；调用之后的推理不改变配对关系。
			if (roundFirstCall < 0 && hasReasoningText(item)) {
				roundHasReasoningText = true;
			}
			continue;
		}
		if (hasTypeIn(item, TOOL_CALL_TYPES)) {
			if (roundFirstCall < 0) {
				roundFirstCall = index;
			}
			continue;
		}
		if (hasTypeIn(item, TOOL_OUTPUT_TYPES)) {
			closeRound();
		}
	}
	closeRound();

	if (insertBefore.length === 0) {
		return body;
	}
	const nextInput = [...input];
	// 从后往前插入，避免前面的补位改变后续下标。
	for (const index of [...insertBefore].reverse()) {
		nextInput.splice(index, 0, { type: "reasoning", content: [{ type: "reasoning_text", text: placeholderText }] });
	}
	return { ...body, input: nextInput };
}
