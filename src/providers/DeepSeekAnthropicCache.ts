type Body = Record<string, unknown>;

function isBlock(value: unknown): value is Body {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isClaudeCodeBillingBlock(block: unknown): boolean {
	return (
		isBlock(block) &&
		block.type === "text" &&
		typeof block.text === "string" &&
		/^x-anthropic-billing-header: *cc_version=[^;\r\n]+; *(?:[\w-]+=[^;\r\n]*; *)*cch=[\da-f]+;? *$/iu.test(block.text)
	);
}

/**
 * Claude Code puts a per-request Anthropic billing checksum ahead of every model token. For
 * DeepSeek's automatic cache, omit that telemetry block and canonicalize the CLI's moving
 * ephemeral markers and equivalent single-text representations. Tool input and signed thinking
 * keep their original payloads. Apply the projection only to the selected upstream attempt.
 * @param body - Unmodified source of the provider request body.
 * @param model - Actual upstream model, after routing.
 */
export function projectDeepSeekClaudeCodePrefix(body: Body, model: string): Body {
	const system = body.system;
	if (!/(?:^|\/)deepseek[-/]/iu.test(model) || !Array.isArray(system) || !isClaudeCodeBillingBlock(system[0])) {
		return body;
	}
	const result = { ...body, system: system.slice(1) };
	if (!Array.isArray(body.messages)) {
		return result;
	}
	const messages = body.messages.map((message: unknown) => {
		if (!isBlock(message) || !Array.isArray(message.content)) {
			return message;
		}
		const content = message.content.map((block: unknown) => {
			if (!isBlock(block) || !isBlock(block.cache_control) || block.cache_control.type !== "ephemeral") {
				return block;
			}
			const { cache_control: _breakpoint, ...payload } = block;
			return payload;
		});
		const part: unknown = content[0];
		if (
			content.length === 1 &&
			isBlock(part) &&
			part.type === "text" &&
			typeof part.text === "string" &&
			Object.keys(part).length === 2
		) {
			return { ...message, content: part.text };
		}
		return { ...message, content: content };
	});
	return { ...result, messages: messages };
}
