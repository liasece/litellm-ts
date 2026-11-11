import { projectDeepSeekClaudeCodePrefix } from "./DeepSeekAnthropicCache";

it("keeps Claude Code's previous public input identical across DeepSeek turns and preserves an Anthropic attempt", () => {
	const model = "deepseek/deepseek-v4.1-flash";
	const makeSystem = (check: string) => [
		{ type: "text", text: `x-anthropic-billing-header: cc_version=2.1.89; cc_entrypoint=cli; cch=${check};` },
		{ type: "text", text: "System policy" },
	];
	const user = { role: "user", content: "draw a tree" };
	const mark = { type: "ephemeral" };
	const first = {
		system: makeSystem("10caf"),
		messages: [{ role: "user", content: [{ type: "text", text: user.content, cache_control: mark }] }],
	};
	const tool = {
		role: "assistant",
		content: [{ type: "tool_use", id: "read", name: "Read", input: { cache_control: "inside tool arguments" } }],
	};
	const toolResult = { role: "user", content: [{ type: "tool_result", tool_use_id: "read", content: "delivered" }] };
	const receipt = { role: "user", content: "[LiteLLM image operation record]" };
	const second = {
		system: makeSystem("210af"),
		messages: [user, tool, { role: "user", content: [{ ...toolResult.content[0], cache_control: mark }] }, receipt],
	};
	const third = { system: makeSystem("310af"), messages: [user, tool, toolResult, receipt, { role: "user", content: "Verify it" }] };
	const projected = [first, second, third].map((x) => projectDeepSeekClaudeCodePrefix(x, model));
	for (let i = 1; i < projected.length; i++) {
		const prev = projected[i - 1]!,
			current = projected[i]!;
		expect(current.system).toEqual(prev.system);
		expect((current.messages as unknown[]).slice(0, (prev.messages as unknown[]).length)).toEqual(prev.messages);
	}
	expect((projected[1]!.messages as unknown[])[1]).toEqual(tool);
	expect(projectDeepSeekClaudeCodePrefix(first, "claude-sonnet-4-6")).toBe(first);
	expect(first.messages[0]!.content[0]!.cache_control).toEqual(mark);
	const other = { ...first, system: [{ type: "text", text: "x-anthropic-billing-header: keep this user's instructions" }] };
	expect(projectDeepSeekClaudeCodePrefix(other, model)).toBe(other);
});
