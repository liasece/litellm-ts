import { addResponseUsage, normalizeUsageTokens, toChatUsage } from "./usage";

describe("usage across protocol conversion and hidden capability turns", () => {
	it("keeps Responses cache writes, reasoning and other token details when converting to Chat", () => {
		const native = {
			input_tokens: 1200,
			output_tokens: 30,
			total_tokens: 1230,
			cost: 0.25,
			input_tokens_details: { cached_tokens: 1024, cache_write_tokens: 32, audio_tokens: 8 },
			output_tokens_details: { reasoning_tokens: 5, audio_tokens: 2 },
		};
		const original = structuredClone(native);
		const chat = toChatUsage(native);
		expect(chat).toEqual({
			prompt_tokens: 1200,
			completion_tokens: 30,
			total_tokens: 1230,
			cost: 0.25,
			prompt_tokens_details: { cached_tokens: 1024, cache_creation_tokens: 32, audio_tokens: 8 },
			completion_tokens_details: { reasoning_tokens: 5, audio_tokens: 2 },
		});
		expect(normalizeUsageTokens(chat as unknown as Record<string, unknown>)).toEqual(normalizeUsageTokens(native));
		chat.prompt_tokens_details!.cached_tokens = 1;
		expect(native).toEqual(original);
	});

	it("adds cached and reasoning tokens from earlier Chat turns without changing those turns", () => {
		const first = {
			usage: {
				prompt_tokens: 100,
				completion_tokens: 10,
				total_tokens: 110,
				cost: 0.1,
				prompt_tokens_details: {
					cached_tokens: 80,
					cache_creation_tokens: 10,
					cache_creation_token_details: { ephemeral_5m_input_tokens: 10 },
				},
				completion_tokens_details: { reasoning_tokens: 3, audio_tokens: 1 },
			},
		};
		const firstSnapshot = structuredClone(first);
		const last = {
			usage: {
				prompt_tokens: 200,
				completion_tokens: 20,
				total_tokens: 220,
				cost: 0.2,
				prompt_tokens_details: {
					cached_tokens: 160,
					cache_creation_tokens: 20,
					cache_creation_token_details: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 15 },
				},
				completion_tokens_details: { reasoning_tokens: 7, audio_tokens: 2 },
			},
		};
		addResponseUsage(last, first);
		expect(last.usage).toMatchObject({
			prompt_tokens: 300,
			completion_tokens: 30,
			total_tokens: 330,
			prompt_tokens_details: {
				cached_tokens: 240,
				cache_creation_tokens: 30,
				cache_creation_token_details: { ephemeral_5m_input_tokens: 15, ephemeral_1h_input_tokens: 15 },
			},
			completion_tokens_details: { reasoning_tokens: 10, audio_tokens: 3 },
		});
		expect(last.usage.cost).toBeCloseTo(0.3);
		expect(first).toEqual(firstSnapshot);
	});

	it("keeps Anthropic uncached input and cache TTL buckets separate across turns", () => {
		const first = {
			usage: {
				input_tokens: 30,
				output_tokens: 4,
				cache_read_input_tokens: 60,
				cache_creation_input_tokens: 10,
				cache_creation: { ephemeral_5m_input_tokens: 10 },
			},
		};
		const last = {
			usage: {
				input_tokens: 20,
				output_tokens: 5,
				cache_read_input_tokens: 100,
				cache_creation_input_tokens: 20,
				cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 15 },
			},
		};
		addResponseUsage(last, first);
		expect(last.usage).toEqual({
			input_tokens: 50,
			output_tokens: 9,
			cache_read_input_tokens: 160,
			cache_creation_input_tokens: 30,
			cache_creation: { ephemeral_5m_input_tokens: 15, ephemeral_1h_input_tokens: 15 },
		});
		expect(normalizeUsageTokens(last.usage)).toMatchObject({ prompt_tokens: 240, completion_tokens: 9, total_tokens: 249 });
	});

	it("normalizes mixed Chat/Anthropic aliases once when a fallback changes the usage shape", () => {
		const last = {
			usage: {
				prompt_tokens: 100,
				completion_tokens: 10,
				total_tokens: 110,
				prompt_tokens_details: { cached_tokens: 80 },
				cache_read_input_tokens: 80,
			},
		};
		addResponseUsage(last, {
			usage: { input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 20, cache_creation_input_tokens: 5 },
		});
		expect(last.usage).toMatchObject({
			prompt_tokens: 135,
			completion_tokens: 12,
			total_tokens: 147,
			prompt_tokens_details: { cached_tokens: 100, cache_creation_tokens: 5 },
			cache_read_input_tokens: 100,
		});
	});

	it("preserves Responses field names when aggregating native Responses turns", () => {
		const last = {
			usage: {
				input_tokens: 200,
				output_tokens: 20,
				total_tokens: 220,
				input_tokens_details: { cached_tokens: 160, cache_write_tokens: 20 },
				output_tokens_details: { reasoning_tokens: 7 },
			},
		};
		addResponseUsage(last, {
			usage: {
				input_tokens: 100,
				output_tokens: 10,
				total_tokens: 110,
				input_tokens_details: { cached_tokens: 80, cache_write_tokens: 10 },
				output_tokens_details: { reasoning_tokens: 3 },
			},
		});
		expect(last.usage).toEqual({
			input_tokens: 300,
			output_tokens: 30,
			total_tokens: 330,
			input_tokens_details: { cached_tokens: 240, cache_write_tokens: 30 },
			output_tokens_details: { reasoning_tokens: 10 },
		});
	});

	it("recovers earlier usage when the last turn omits it, and skips turns without usage", () => {
		const source = {
			usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 80 } },
		};
		Object.freeze(source.usage.prompt_tokens_details);
		Object.freeze(source.usage);
		const last: Record<string, unknown> = {};
		addResponseUsage(last, source);
		addResponseUsage(last, {});
		expect(last["usage"]).toEqual(source.usage);
		expect(last["usage"]).not.toBe(source.usage);
	});

	it("respects explicit zero cache over lower priority aliases without counting aliases twice", () => {
		const last = {
			usage: {
				prompt_tokens: 100,
				completion_tokens: 10,
				total_tokens: 110,
				prompt_tokens_details: { cached_tokens: 0 },
				cache_read_input_tokens: 80,
			},
		};
		addResponseUsage(last, {
			usage: {
				input_tokens: 200,
				output_tokens: 20,
				total_tokens: 220,
				input_tokens_details: { cached_tokens: 0 },
				cache_read_input_tokens: 160,
			},
		});
		expect(last.usage).toMatchObject({
			prompt_tokens: 300,
			completion_tokens: 30,
			total_tokens: 330,
			prompt_tokens_details: { cached_tokens: 0 },
			cache_read_input_tokens: 0,
		});
	});
});
