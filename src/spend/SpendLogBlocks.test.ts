import {
	SPEND_LOG_INPUT_REF_KEY,
	SPEND_LOG_MESSAGE_REF_KEY,
	SPEND_LOG_REF_BYTES_KEY,
	SPEND_LOG_REF_MISSING_KEY,
	SPEND_LOG_SAME_AS_MESSAGES,
	SPEND_LOG_SYSTEM_COUNT_KEY,
	SPEND_LOG_SYSTEM_FIRST_KEY,
	SPEND_LOG_SYSTEM_REF_KEY,
	SPEND_LOG_SYSTEM_SECOND_KEY,
	SPEND_LOG_TOOLS_COUNT_KEY,
	SPEND_LOG_TOOLS_FIRST_KEY,
	SPEND_LOG_TOOLS_REF_KEY,
	canonicalJson,
	collectReferencedBlockIds,
	collectSpendLogBlocks,
	restoreSpendLogPayload,
	spendLogBlockId,
} from "./SpendLogBlocks";

function makeMessages(count: number): Record<string, unknown>[] {
	return Array.from({ length: count }, (_unused, index) => ({
		role: index % 2 === 0 ? "user" : "assistant",
		content: `message-${index}`,
	}));
}

function isRefWrapper(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) && SPEND_LOG_MESSAGE_REF_KEY in value;
}

describe("canonicalJson", () => {
	it("对象键序不影响结果，且按字节长度再按字节序排列", () => {
		const left = canonicalJson({ bb: 1, a: 2, ccc: 3 });
		const right = canonicalJson({ ccc: 3, a: 2, bb: 1 });
		expect(left).toBe(right);
		// `a`(1) < `bb`(2) < `ccc`(3)：与 PostgreSQL jsonb 的输出顺序一致
		expect(left).toBe('{"a":2,"bb":1,"ccc":3}');
	});

	it("嵌套对象同样规范化，数组保序", () => {
		expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
		expect(canonicalJson({ list: [3, 1, 2] })).toBe('{"list":[3,1,2]}');
	});

	it("标量沿用 JSON.stringify 语义", () => {
		expect(canonicalJson("文本")).toBe('"文本"');
		expect(canonicalJson(1.5)).toBe("1.5");
		expect(canonicalJson(null)).toBe("null");
		expect(canonicalJson(undefined)).toBe("null");
	});
});

describe("spendLogBlockId", () => {
	it("是 22 字符的 base64url", () => {
		expect(spendLogBlockId({ role: "user" })).toMatch(/^[A-Za-z0-9_-]{22}$/u);
	});

	it("相同内容得到同一个 id，键序不同也一样", () => {
		expect(spendLogBlockId({ a: 1, b: 2 })).toBe(spendLogBlockId({ b: 2, a: 1 }));
	});

	it("内容不同得到不同 id", () => {
		expect(spendLogBlockId({ content: "1" })).not.toBe(spendLogBlockId({ content: "2" }));
	});
});

describe("collectSpendLogBlocks", () => {
	it("长数组改写成引用，短数组保持内联", () => {
		const long = makeMessages(5);
		const encoded = collectSpendLogBlocks({ messages: long, proxyServerRequest: {} });
		expect(isRefWrapper(encoded.messages)).toBe(true);
		const refs = (encoded.messages as Record<string, unknown>)[SPEND_LOG_MESSAGE_REF_KEY] as string[];
		expect(refs).toHaveLength(5);
		expect((encoded.messages as Record<string, unknown>)[SPEND_LOG_REF_BYTES_KEY]).toBeGreaterThan(0);
		expect(encoded.blocks).toHaveLength(5);

		const shortMessages = makeMessages(2);
		const shortEncoded = collectSpendLogBlocks({ messages: shortMessages, proxyServerRequest: {} });
		expect(shortEncoded.messages).toEqual(shortMessages);
		expect(shortEncoded.blocks).toHaveLength(0);
	});

	it("同一份对话在 messages 与 body.messages 里只产生一份块", () => {
		const messages = makeMessages(6);
		const encoded = collectSpendLogBlocks({
			messages,
			proxyServerRequest: { url: "/v1/chat/completions", body: { messages, model: "gpt" } },
		});
		// 6 条消息 → 6 个块，两条副本复用同一批 id
		expect(encoded.blocks).toHaveLength(6);
		const body = (encoded.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(body["messages"]).toBeUndefined();
		// 与列根引用完全相同时不重复写 id 列表
		expect(body[SPEND_LOG_MESSAGE_REF_KEY]).toBe(SPEND_LOG_SAME_AS_MESSAGES);
		expect(body["model"]).toBe("gpt");
	});

	it("input 与上游请求体同样改写，重复内容只留一条块", () => {
		const messages = makeMessages(4);
		const encoded = collectSpendLogBlocks({
			messages,
			proxyServerRequest: {
				body: { input: messages },
				upstream_request: { body: { messages } },
			},
		});
		expect(encoded.blocks).toHaveLength(4);
		const body = (encoded.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(body[SPEND_LOG_INPUT_REF_KEY]).toBe(SPEND_LOG_SAME_AS_MESSAGES);
		const upstreamBody = ((encoded.proxyServerRequest as Record<string, unknown>)["upstream_request"] as Record<string, unknown>)[
			"body"
		] as Record<string, unknown>;
		expect(upstreamBody[SPEND_LOG_MESSAGE_REF_KEY]).toBe(SPEND_LOG_SAME_AS_MESSAGES);
	});

	it("名不副实的引用键或标量保持原样", () => {
		const notAnArray = { hello: "world" };
		expect(collectSpendLogBlocks({ messages: notAnArray, proxyServerRequest: {} }).messages).toEqual(notAnArray);
		expect(collectSpendLogBlocks({ messages: "裸字符串提示词", proxyServerRequest: {} }).messages).toBe("裸字符串提示词");
		expect(collectSpendLogBlocks({ messages: {}, proxyServerRequest: {} }).messages).toEqual({});
	});

	it("客户端自带的引用键会被剥离，不会被当成引用", () => {
		const forged = { [SPEND_LOG_MESSAGE_REF_KEY]: ["AAAAAAAAAAAAAAAAAAAAAA"], keep: 1 };
		const encoded = collectSpendLogBlocks({ messages: forged, proxyServerRequest: { body: { ...forged } } });
		expect((encoded.messages as Record<string, unknown>)[SPEND_LOG_MESSAGE_REF_KEY]).toBeUndefined();
		expect((encoded.messages as Record<string, unknown>)["keep"]).toBe(1);
		const body = (encoded.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(body[SPEND_LOG_MESSAGE_REF_KEY]).toBeUndefined();
	});
});

describe("collectReferencedBlockIds", () => {
	it("收集三处引用的 id 并去重", () => {
		const messages = makeMessages(4);
		const encoded = collectSpendLogBlocks({
			messages,
			proxyServerRequest: { body: { messages }, upstream_request: { body: { messages } } },
		});
		const ids = collectReferencedBlockIds(encoded.messages, encoded.proxyServerRequest);
		expect(ids).toHaveLength(4);
	});

	it("内联行没有任何引用", () => {
		expect(collectReferencedBlockIds(makeMessages(2), { body: { messages: makeMessages(2) } })).toEqual([]);
	});
});

describe("restoreSpendLogPayload", () => {
	it("往返还原：编码后再组装得到等价内容", () => {
		const messages = makeMessages(5);
		const encoded = collectSpendLogBlocks({
			messages,
			proxyServerRequest: { url: "/v1/chat/completions", body: { messages, model: "gpt" } },
		});
		const payloads = new Map(encoded.blocks.map((block) => [block.blockId, block.payload] as const));
		const restored = restoreSpendLogPayload(
			{ messages: encoded.messages, proxy_server_request: encoded.proxyServerRequest },
			(blockId) => payloads.get(blockId),
		);
		expect(restored.messages).toEqual(messages);
		const body = (restored.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(body["messages"]).toEqual(messages);
		expect(body["model"]).toBe("gpt");
		expect(restored.missingBlockIds).toEqual([]);
	});

	it("缺块时用占位对象补齐并报告缺失的 id", () => {
		const encoded = collectSpendLogBlocks({ messages: makeMessages(4), proxyServerRequest: {} });
		const refs = (encoded.messages as Record<string, unknown>)[SPEND_LOG_MESSAGE_REF_KEY] as string[];
		const restored = restoreSpendLogPayload(
			{ messages: encoded.messages },
			(blockId) => (blockId === refs[0] ? { role: "user", content: "message-0" } : undefined),
		);
		expect((restored.messages as unknown[])[0]).toEqual({ role: "user", content: "message-0" });
		expect((restored.messages as unknown[])[1]).toEqual({ [SPEND_LOG_REF_MISSING_KEY]: refs[1] });
		expect(restored.missingBlockIds).toHaveLength(3);
	});

	it("历史行的字面量原样返回", () => {
		const messages = makeMessages(2);
		const restored = restoreSpendLogPayload(
			{ messages, proxy_server_request: { body: { messages } } },
			() => undefined,
		);
		expect(restored.messages).toEqual(messages);
		expect((restored.proxyServerRequest as Record<string, unknown>)["body"]).toEqual({ messages });
		expect(restored.missingBlockIds).toEqual([]);
	});

	it("形态不合法的引用键按字面量处理，不会触发查询", () => {
		const forged = { [SPEND_LOG_MESSAGE_REF_KEY]: ["not-a-valid-id"] };
		const restored = restoreSpendLogPayload({ messages: forged }, () => {
			throw new Error("不应查询块表");
		});
		expect(restored.messages).toEqual(forged);
	});
});

function makeTools(count: number): Record<string, unknown>[] {
	return Array.from({ length: count }, (_unused, index) => ({
		type: "function",
		name: index === 0 ? "web_search" : `tool-${index}`,
		description: `tool-${index} 的描述`,
		input_schema: { type: "object", properties: { q: { type: "string" } } },
	}));
}

function makeSystem(): Record<string, unknown>[] {
	return [
		{ type: "text", text: "你是助手。" + "很长的系统提示".repeat(40) },
		{ type: "text", text: "补充约束。" + "次要提示".repeat(80) },
	];
}

describe("collectSpendLogBlocks：tools 与 system 整数组块化", () => {
	it("整体换成一个引用 id，并留下时间线需要的计数与首项", () => {
		const tools = makeTools(3);
		const system = makeSystem();
		const encoded = collectSpendLogBlocks({
			messages: makeMessages(2),
			proxyServerRequest: { body: { tools, system, model: "claude" } },
		});
		const body = (encoded.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(body["tools"]).toBeUndefined();
		expect(body["system"]).toBeUndefined();
		expect(body[SPEND_LOG_TOOLS_REF_KEY]).toMatch(/^[A-Za-z0-9_-]{22}$/u);
		expect(body[SPEND_LOG_TOOLS_COUNT_KEY]).toBe(3);
		expect(body[SPEND_LOG_TOOLS_FIRST_KEY]).toBe("web_search");
		expect(body[SPEND_LOG_SYSTEM_COUNT_KEY]).toBe(2);
		expect((body[SPEND_LOG_SYSTEM_FIRST_KEY] as string).startsWith("你是助手。")).toBe(true);
		expect((body[SPEND_LOG_SYSTEM_FIRST_KEY] as string).length).toBe(256);
		expect((body[SPEND_LOG_SYSTEM_SECOND_KEY] as string).startsWith("补充约束。")).toBe(true);
		expect(body["model"]).toBe("claude");
		// 工具数组一个块、system 一个块（消息不足 4 条保持内联）
		expect(encoded.blocks).toHaveLength(2);
	});

	it("下游与上游的两份工具定义各自编码，跨请求复用同一批块", () => {
		const tools = makeTools(3);
		const upstreamTools = [...tools, { type: "function", name: "sea" }];
		const left = collectSpendLogBlocks({
			messages: {},
			proxyServerRequest: {
				body: { tools },
				upstream_request: { body: { tools: upstreamTools } },
			},
		});
		const right = collectSpendLogBlocks({ messages: {}, proxyServerRequest: { body: { tools } } });
		const leftBody = (left.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		const leftUpstream = ((left.proxyServerRequest as Record<string, unknown>)["upstream_request"] as Record<string, unknown>)[
			"body"
		] as Record<string, unknown>;
		expect(leftBody[SPEND_LOG_TOOLS_REF_KEY]).not.toBe(leftUpstream[SPEND_LOG_TOOLS_REF_KEY]);
		expect(leftUpstream[SPEND_LOG_TOOLS_COUNT_KEY]).toBe(4);
		// 第二次请求的工具集没变：命中的是同一批 id
		const rightBody = (right.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(rightBody[SPEND_LOG_TOOLS_REF_KEY]).toBe(leftBody[SPEND_LOG_TOOLS_REF_KEY]);
		expect(right.blocks).toHaveLength(1);
	});

	it("空数组与标量保持内联", () => {
		const encoded = collectSpendLogBlocks({
			messages: {},
			proxyServerRequest: { body: { tools: [], system: [], model: "gpt" } },
		});
		const body = (encoded.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(body["tools"]).toEqual([]);
		expect(body["system"]).toEqual([]);
		expect(encoded.blocks).toHaveLength(0);
	});

	it("客户端自带的 tools/system 引用键会被剥离", () => {
		const forged = {
			tools: makeTools(1),
			[SPEND_LOG_TOOLS_REF_KEY]: "AAAAAAAAAAAAAAAAAAAAAA",
			[SPEND_LOG_TOOLS_COUNT_KEY]: 99,
			[SPEND_LOG_SYSTEM_REF_KEY]: "BBBBBBBBBBBBBBBBBBBBBB",
		};
		const encoded = collectSpendLogBlocks({ messages: {}, proxyServerRequest: { body: forged } });
		const body = (encoded.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		// 伪造的计数被真实计算值覆盖，伪造的 system 引用被丢弃
		expect(body[SPEND_LOG_TOOLS_COUNT_KEY]).toBe(1);
		expect(body[SPEND_LOG_SYSTEM_REF_KEY]).toBeUndefined();
		expect((body[SPEND_LOG_TOOLS_REF_KEY] as string)).not.toBe("AAAAAAAAAAAAAAAAAAAAAA");
	});
});

describe("restoreSpendLogPayload：tools / system / $messages", () => {
	it("往返还原工具定义与 system，并去掉分类投影键", () => {
		const tools = makeTools(3);
		const system = makeSystem();
		const messages = makeMessages(4);
		const encoded = collectSpendLogBlocks({
			messages,
			proxyServerRequest: { body: { messages, tools, system }, upstream_request: { body: { tools } } },
		});
		const payloads = new Map(encoded.blocks.map((block) => [block.blockId, block.payload] as const));
		const restored = restoreSpendLogPayload(
			{ messages: encoded.messages, proxy_server_request: encoded.proxyServerRequest },
			(blockId) => payloads.get(blockId),
		);
		const body = (restored.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(body["messages"]).toEqual(messages);
		expect(body["tools"]).toEqual(tools);
		expect(body["system"]).toEqual(system);
		for (const key of [
			SPEND_LOG_TOOLS_REF_KEY,
			SPEND_LOG_TOOLS_COUNT_KEY,
			SPEND_LOG_TOOLS_FIRST_KEY,
			SPEND_LOG_SYSTEM_REF_KEY,
			SPEND_LOG_SYSTEM_COUNT_KEY,
			SPEND_LOG_SYSTEM_FIRST_KEY,
			SPEND_LOG_SYSTEM_SECOND_KEY,
		]) {
			expect(body[key]).toBeUndefined();
		}
		const upstreamBody = ((restored.proxyServerRequest as Record<string, unknown>)["upstream_request"] as Record<string, unknown>)[
			"body"
		] as Record<string, unknown>;
		expect(upstreamBody["tools"]).toEqual(tools);
		expect(restored.missingBlockIds).toEqual([]);
	});

	it("工具块缺失时用占位对象，不影响其它字段", () => {
		const encoded = collectSpendLogBlocks({ messages: {}, proxyServerRequest: { body: { tools: makeTools(2) } } });
		const restored = restoreSpendLogPayload(
			{ messages: {}, proxy_server_request: encoded.proxyServerRequest },
			() => undefined,
		);
		const body = (restored.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect((body["tools"] as Record<string, unknown>)[SPEND_LOG_REF_MISSING_KEY]).toHaveLength(22);
		expect(restored.missingBlockIds).toHaveLength(1);
	});

	it("$messages 标记按同行列根引用还原；两者不同则分别还原", () => {
		const column = makeMessages(4);
		const bodyMessages = [...column, { role: "user", content: "新的追问" }];
		const encoded = collectSpendLogBlocks({
			messages: column,
			proxyServerRequest: { body: { messages: bodyMessages } },
		});
		const payloads = new Map(encoded.blocks.map((block) => [block.blockId, block.payload] as const));
		const body = (encoded.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(Array.isArray(body[SPEND_LOG_MESSAGE_REF_KEY])).toBe(true);
		const restored = restoreSpendLogPayload(
			{ messages: encoded.messages, proxy_server_request: encoded.proxyServerRequest },
			(blockId) => payloads.get(blockId),
		);
		const restoredBody = (restored.proxyServerRequest as Record<string, unknown>)["body"] as Record<string, unknown>;
		expect(restoredBody["messages"]).toEqual(bodyMessages);
	});
});
