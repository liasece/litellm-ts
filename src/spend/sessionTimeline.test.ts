import { SessionTimelineBuilder, type SessionTimelineSourceRow } from "./sessionTimeline";

function makeRow(overrides: Partial<SessionTimelineSourceRow>): SessionTimelineSourceRow {
	return {
		request_id: "req-1",
		call_type: "completion",
		spend: 0.01,
		total_tokens: 10,
		startTime: "2026-07-24T10:00:00.000Z",
		endTime: "2026-07-24T10:00:01.000Z",
		model: "claude",
		status: "success",
		metadata_status: null,
		error_information: null,
		request_payload: {},
		response_payload: {},
		...overrides,
	};
}

describe("SessionTimelineBuilder", () => {
	it("缺块占位对象作为结构化部件保留，不退化成空消息", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: [{ role: "user", content: "正常消息" }, { _litellm_ref_missing: "AAAAAAAAAAAAAAAAAAAAAA" }],
				response_payload: {},
			}),
		);

		const parts = builder.build().data.flatMap((item) => item.parts ?? []);
		expect(parts).toEqual(
			expect.arrayContaining([expect.objectContaining({ data: { _litellm_ref_missing: "AAAAAAAAAAAAAAAAAAAAAA" } })]),
		);
	});

	it("上游 payload 显式带空 system/instructions 时不生成空系统事件", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: {
					messages: null,
					input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
					system: null,
					instructions: null,
				},
				response_payload: {},
			}),
		);

		expect(builder.build().data.map((item) => item.role)).toEqual(["user"]);
	});

	it("空字符串 system 也不生成空系统事件", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: {
					messages: null,
					input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
					system: "",
					instructions: null,
				},
				response_payload: {},
			}),
		);

		expect(builder.build().data.map((item) => item.role)).toEqual(["user"]);
	});

	it("后续快照补出的历史按请求内顺序插入已有回复之前，不受同时间戳影响", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: [{ role: "user", content: "开始" }],
				response_payload: { choices: [{ message: { role: "assistant", content: "已有回复" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-2",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				request_payload: [
					{ role: "user", content: "开始" },
					{ role: "user", content: "补出的上下文" },
					{ role: "assistant", content: "已有回复" },
					{ role: "user", content: "下一问" },
				],
				response_payload: { choices: [{ message: { role: "assistant", content: "下一答" } }] },
			}),
		);

		expect(builder.build().data.map((item) => item.content)).toEqual(["开始", "补出的上下文", "已有回复", "下一问", "下一答"]);
	});

	it("使用压缩快照中的历史边界连接消息，优先于请求时间与结束时间", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				endTime: "2026-07-24T10:00:10.000Z",
				request_payload: [{ role: "user", content: "第一问" }],
				response_payload: { choices: [{ message: { role: "assistant", content: "第一答" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-2",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				request_message_delta_flags: [false, true],
				request_payload: [
					{ role: "assistant", content: "第一答" },
					{ role: "user", content: "第二问" },
				],
				response_payload: { choices: [{ message: { role: "assistant", content: "第二答" } }] },
			}),
		);

		expect(builder.build().data.map((item) => item.content)).toEqual(["第一问", "第一答", "第二问", "第二答"]);
	});

	it("互不关联的并发请求按时间穿插，并保留各请求内部顺序", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				endTime: "2026-07-24T10:00:10.000Z",
				request_payload: [{ role: "user", content: "独立问题 A" }],
				response_payload: { choices: [{ message: { role: "assistant", content: "独立回复 A" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-2",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				request_payload: [
					{ role: "user", content: "独立问题 B" },
					{ role: "user", content: "B 的补充" },
				],
				response_payload: { choices: [{ message: { role: "assistant", content: "独立回复 B" } }] },
			}),
		);

		expect(builder.build().data.map((item) => item.content)).toEqual([
			"独立问题 A",
			"独立问题 B",
			"B 的补充",
			"独立回复 B",
			"独立回复 A",
		]);
	});

	it("矛盾历史仍输出所有事件，并在重复 build 后继续接收请求", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: [
					{ role: "user", content: "A" },
					{ role: "assistant", content: "B" },
				],
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-2",
				request_payload: [
					{ role: "assistant", content: "B" },
					{ role: "user", content: "A" },
					{ role: "user", content: "C" },
				],
			}),
		);
		const first = builder.build().data;
		expect(first.map((item) => item.content)).toEqual(["A", "B", "C"]);
		expect(builder.build().data).toEqual(first);
		builder.add(
			makeRow({
				request_id: "req-3",
				request_payload: [
					{ role: "user", content: "C" },
					{ role: "user", content: "D" },
				],
			}),
		);
		expect(
			builder
				.build()
				.data.filter((item) => item.role !== "request")
				.map((item) => item.content),
		).toEqual(["A", "B", "C", "D"]);
	});

	it("内置能力子请求只保留审计标记，不展开内部消息", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_id: "vision-child",
				model: "gpt-5.4-mini",
				internal_call_type: "builtin_capability",
				builtin_capability: "vision",
				parent_request_id: "parent-request",
				request_payload: {
					messages: [{ role: "user", content: "What error is visible?" }],
				},
				response_payload: {
					choices: [{ message: { role: "assistant", content: "TS2322 is visible." } }],
				},
			}),
		);

		expect(builder.build().data).toEqual([
			expect.objectContaining({
				request_id: "vision-child",
				role: "request",
				label: "内部调用",
				content: "vision · completion",
				internal_call: true,
				builtin_capability: "vision",
				parent_request_id: "parent-request",
			}),
		]);
	});

	it("内置能力审计标记不因为父请求像 Claude Code 内部调用而被过滤", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_id: "vision-child",
				request_client: "claude_code",
				request_system_count: 2,
				request_message_count: 1,
				request_tool_count: 0,
				request_second_system_prompt: "Extract any file paths that this command reads or modifies.",
				internal_call_type: "builtin_capability",
				builtin_capability: "vision",
				parent_request_id: "parent-request",
				request_payload: [{ role: "user", content: "What error is visible?" }],
			}),
		);

		const result = builder.build();
		expect(result.data).toHaveLength(1);
		expect(result.data[0]).toMatchObject({
			request_id: "vision-child",
			role: "request",
			internal_call: true,
			builtin_capability: "vision",
			parent_request_id: "parent-request",
		});
		expect(result.summary).toMatchObject({ request_count: 1, filtered_request_count: 0 });
	});

	it("请求消息来自最终上游请求时，私有工具调用直接取上游消息，不再从响应内部字段补一条", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_id: "image-parent",
				request_payload_upstream: true,
				request_payload: {
					messages: [
						{ role: "user", content: "再生成一个狗的图片" },
						{
							role: "assistant",
							content: "",
							tool_calls: [
								{
									id: "call_00_create",
									type: "function",
									function: { name: "litellm__image_create", arguments: '{"prompt":"一只金毛幼犬的写真"}' },
								},
							],
						},
						{ role: "tool", tool_call_id: "call_00_create", content: "已生成图片" },
					],
				},
				response_payload: {
					choices: [{ message: { role: "assistant", content: "好了" } }],
					_builtinPrivateImageToolCalls: [
						{ id: "call_00_create", name: "litellm__image_create", arguments: { prompt: "一只金毛幼犬的写真" } },
					],
				},
			}),
		);

		const data = builder.build().data;
		expect(data.some((item) => item.private_tool_call)).toBe(false);
		expect(data.map((item) => item.role)).toEqual(["user", "assistant", "tool", "assistant"]);
		expect(data[1]?.parts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "tool_call",
					id: "call_00_create",
					name: "litellm__image_create",
					data: { prompt: "一只金毛幼犬的写真" },
				}),
			]),
		);
		expect(data[2]).toMatchObject({ role: "tool", content: "已生成图片" });
		expect(data[3]).toMatchObject({ role: "assistant", content: "好了" });
	});

	it("把模型发起的私有图片工具调用还原为响应之前的独立事件", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_id: "image-parent",
				request_payload: [{ role: "user", content: "再生成一个狗的图片" }],
				response_payload: {
					type: "message",
					role: "assistant",
					content: [{ type: "tool_use", id: "call_send", name: "mcp__company__message_send", input: { text: "好了" } }],
					_builtinPrivateImageToolCalls: [
						{ id: "call_00_create", name: "litellm__image_create", arguments: { prompt: "一只金毛幼犬的写真" } },
					],
				},
			}),
		);

		const data = builder.build().data;
		const privateCall = data.find((item) => item.private_tool_call);
		expect(privateCall).toMatchObject({
			request_id: "image-parent",
			role: "assistant",
			label: "内置能力调用",
			builtin_capability: "image_generation",
		});
		expect(privateCall?.parts).toEqual([
			expect.objectContaining({
				kind: "tool_call",
				id: "call_00_create",
				name: "litellm__image_create",
				data: { prompt: "一只金毛幼犬的写真" },
			}),
		]);
		expect(data.findIndex((item) => item.private_tool_call)).toBeLessThan(
			data.findIndex((item) => item.id === "image-parent:response"),
		);
	});

	it("将 Images API 的 base64 响应转换为可渲染的图片事件", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				call_type: "aimage_generation",
				request_payload: "画一张世界杯主题海报",
				response_payload: {
					data: [
						{
							b64_json: "iVBORw0KGgoAAA",
							revised_prompt: "A World Cup themed poster",
						},
					],
					output_format: "png",
				},
			}),
		);

		const result = builder.build();
		expect(result.data).toHaveLength(2);
		expect(result.data[0]).toMatchObject({
			role: "user",
			content: "画一张世界杯主题海报",
		});
		expect(result.data[1]).toMatchObject({
			role: "assistant",
			content: "A World Cup themed poster",
			parts: [
				{
					kind: "image",
					label: "Generated image",
					sourceType: "image_generation",
					text: "A World Cup themed poster",
					data: {
						src: "data:image/png;base64,iVBORw0KGgoAAA",
						mimeType: "image/png",
					},
				},
			],
		});
	});

	it("在 Responses Function result 中保留图片内容块", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: {
					input: [
						{ type: "function_call", call_id: "call_view", name: "view_image", arguments: '{"path":"image.png"}' },
						{
							type: "function_call_output",
							call_id: "call_view",
							output: [
								{ type: "input_text", text: "Image Size: 100x100." },
								{ type: "image", data: "iVBORw0KGgoAAA", mimeType: "image/png" },
							],
						},
					],
				},
			}),
		);

		const toolResult = builder.build().data.find((item) => item.role === "tool");
		expect(toolResult).toMatchObject({
			content: "Image Size: 100x100.\n[Image]",
			parts: [
				{
					kind: "tool_result",
					label: "Function result",
					id: "call_view",
					parts: [
						{ kind: "text", text: "Image Size: 100x100." },
						{
							kind: "image",
							data: { src: "data:image/png;base64,iVBORw0KGgoAAA", mimeType: "image/png" },
						},
					],
				},
			],
		});
	});

	it("截断的历史图片显示说明而不是返回损坏的 data URI", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				call_type: "aimage_generation",
				request_payload: "生成图片",
				response_payload: {
					data: [
						{
							b64_json:
								"iVBORw0KGgo... (litellm_truncated skipped 100000 chars. Truncation is a DB storage safeguard.) ...IEND",
						},
					],
					output_format: "png",
				},
			}),
		);

		expect(builder.build().data[1]).toMatchObject({
			role: "assistant",
			content: "图片数据在日志入库时被截断，无法显示。",
			parts: [
				{
					kind: "image",
					text: "图片数据在日志入库时被截断，无法显示。",
					data: { truncated: true },
				},
			],
		});
	});

	it("截断的历史输入图片在 Session 时间线中显示说明而不是损坏图片", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: {
					messages: [
						{
							role: "user",
							content: [
								{ type: "text", text: "检查图片" },
								{
									type: "image_url",
									image_url: {
										url: "data:image/png;base64,iVBORw0KGgo... (litellm_truncated skipped 100000 chars. Truncation is a DB storage safeguard.) ...IEND",
									},
								},
							],
						},
					],
				},
			}),
		);

		expect(builder.build().data[0]).toMatchObject({
			role: "user",
			content: "检查图片\n图片数据在日志入库时被截断，无法显示。",
			parts: [
				{ kind: "text", text: "检查图片" },
				{
					kind: "image",
					text: "图片数据在日志入库时被截断，无法显示。",
					data: { truncated: true },
				},
			],
		});
	});

	it("去掉累计请求快照中的历史消息，同时保留再次真实发送的相同文本", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: [{ role: "user", content: "继续" }],
				response_payload: { choices: [{ message: { role: "assistant", content: "第一次回复" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-2",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				request_payload: {
					messages: [
						{ role: "user", content: "继续" },
						{ role: "assistant", content: "第一次回复" },
						{ role: "user", content: "继续" },
					],
				},
				response_payload: { choices: [{ message: { role: "assistant", content: "第二次回复" } }] },
			}),
		);

		const result = builder.build();
		expect(result.data.map((item) => [item.role, item.content])).toEqual([
			["user", "继续"],
			["assistant", "第一次回复"],
			["user", "继续"],
			["assistant", "第二次回复"],
		]);
		expect(result.summary).toMatchObject({
			request_count: 2,
			event_count: 4,
			total_spend: 0.02,
			total_tokens: 20,
			duration_seconds: 3,
		});
	});

	it("压缩后的请求正文使用原快照 occurrence 保留重复输入", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: [{ role: "user", content: "继续" }],
				request_message_occurrences: [1],
				response_payload: { choices: [{ message: { role: "assistant", content: "第一次回复" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-2",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				request_payload: [
					{ role: "assistant", content: "第一次回复" },
					{ role: "user", content: "继续" },
				],
				request_message_occurrences: [1, 2],
				response_payload: { choices: [{ message: { role: "assistant", content: "第二次回复" } }] },
			}),
		);

		expect(builder.build().data.map((item) => [item.role, item.content])).toEqual([
			["user", "继续"],
			["assistant", "第一次回复"],
			["user", "继续"],
			["assistant", "第二次回复"],
		]);
	});

	it("content 是空数组时，有内容的 summary 不会被空容器挡住", () => {
		// 旧实现先取 content（空数组也算「有值」），于是整段思考被渲染成空白。
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				response_payload: {
					output: [
						{
							id: "rs_1",
							type: "reasoning",
							status: "completed",
							content: [],
							summary: [{ type: "summary_text", text: "先核对参考文件。" }],
						},
					],
				},
			}),
		);

		const thinking = builder
			.build()
			.data.flatMap((item) => item.parts ?? [])
			.find((part) => part.kind === "thinking");
		expect(thinking).toMatchObject({ kind: "thinking", text: "先核对参考文件。" });
	});

	it("summary 有内容时优先显示摘要而不是完整 reasoning 正文", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				response_payload: {
					output: [
						{
							id: "rs_2",
							type: "reasoning",
							status: "completed",
							content: [{ type: "reasoning_text", text: "很长的内部推理过程" }],
							summary: [{ type: "summary_text", text: "简短摘要" }],
						},
					],
				},
			}),
		);

		const thinking = builder
			.build()
			.data.flatMap((item) => item.parts ?? [])
			.find((part) => part.kind === "thinking");
		expect(thinking).toMatchObject({ kind: "thinking", text: "简短摘要" });
	});

	it("在交错的长短快照中按语义去重历史，并忽略响应与历史间的 reasoning 差异", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: { messages: [{ role: "user", content: "根请求" }] },
				response_payload: {
					choices: [
						{
							message: {
								role: "assistant",
								content: "回复 A",
								reasoning_content: "响应中有、后续历史中没有的推理",
							},
						},
					],
				},
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-2",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				request_payload: {
					messages: [
						{ role: "user", content: "根请求" },
						{ role: "assistant", content: "回复 A" },
						{ role: "user", content: "分支 B" },
					],
				},
				response_payload: { choices: [{ message: { role: "assistant", content: "回复 B" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-3",
				startTime: "2026-07-24T10:00:04.000Z",
				endTime: "2026-07-24T10:00:05.000Z",
				request_payload: {
					messages: [
						{ role: "user", content: "根请求" },
						{ role: "user", content: "短分支 C" },
					],
				},
				response_payload: { choices: [{ message: { role: "assistant", content: "回复 C" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-4",
				startTime: "2026-07-24T10:00:06.000Z",
				endTime: "2026-07-24T10:00:07.000Z",
				request_payload: {
					messages: [
						{ role: "user", content: "根请求" },
						{ role: "assistant", content: "回复 A" },
						{ role: "user", content: "分支 B" },
						{ role: "assistant", content: "回复 B" },
						{ role: "user", content: "继续主分支 D" },
					],
				},
				response_payload: { choices: [{ message: { role: "assistant", content: "回复 D" } }] },
			}),
		);

		expect(builder.build().data.map((item) => [item.request_id, item.role, item.content])).toEqual([
			["req-1", "user", "根请求"],
			["req-1", "assistant", "[Thinking]\n响应中有、后续历史中没有的推理\n回复 A"],
			["req-2", "user", "分支 B"],
			["req-2", "assistant", "回复 B"],
			["req-3", "user", "短分支 C"],
			["req-3", "assistant", "回复 C"],
			["req-4", "user", "继续主分支 D"],
			["req-4", "assistant", "回复 D"],
		]);
	});

	it("将工具输出拆成独立时间线事件，不把它伪装成用户输入", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: {
					messages: [
						{
							role: "assistant",
							content: [{ type: "tool_use", id: "tool-1", name: "search", input: { q: "world cup" } }],
						},
						{
							role: "user",
							content: [{ type: "tool_result", tool_use_id: "tool-1", content: "result" }],
						},
					],
				},
			}),
		);

		const result = builder.build();
		const toolCallEvent = result.data.find((item) => item.parts?.some((part) => part.kind === "tool_call"));
		const toolResultEvent = result.data.find((item) => item.role === "tool");
		expect(toolCallEvent?.parts?.map((part) => part.kind)).toEqual(["tool_call"]);
		expect(toolResultEvent).toEqual(
			expect.objectContaining({
				role: "tool",
				label: "工具结果",
				content: "result",
				parts: [expect.objectContaining({ kind: "tool_result", id: "tool-1", name: "search", text: "result" })],
			}),
		);
		expect(result.data.some((item) => item.role === "user" && item.content === "result")).toBe(false);
	});

	it("混合 user 消息中的工具结果与真实用户文本分别生成事件", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: {
					messages: [
						{
							role: "assistant",
							content: [{ type: "tool_use", id: "tool-1", name: "read_file", input: { path: "README.md" } }],
						},
						{
							role: "user",
							content: [
								{ type: "tool_result", tool_use_id: "tool-1", content: "文件内容" },
								{ type: "text", text: "接着检查测试" },
							],
						},
					],
				},
			}),
		);

		expect(builder.build().data.map((item) => [item.role, item.content])).toEqual([
			["assistant", ""],
			["tool", "文件内容"],
			["user", "接着检查测试"],
		]);
	});

	it("解析 OpenAI Responses 累计历史并归并工具输出", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_payload: [
					{
						type: "additional_tools",
						role: "developer",
						tools: [{ type: "custom", name: "exec" }],
					},
					{
						type: "message",
						role: "developer",
						content: [{ type: "input_text", text: "系统规则" }],
					},
					{
						type: "message",
						role: "user",
						content: [{ type: "input_text", text: "检查任务" }],
					},
					{
						type: "reasoning",
						summary: [{ type: "summary_text", text: "正在分析" }],
					},
					{
						type: "custom_tool_call",
						call_id: "call-exec",
						name: "exec",
						input: "git status",
					},
					{
						type: "custom_tool_call_output",
						call_id: "call-exec",
						output: "工作区干净",
					},
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: "继续等待测试" }],
					},
					{
						type: "function_call",
						call_id: "call-wait",
						name: "wait",
						arguments: '{"cell_id":"423"}',
					},
					{
						type: "function_call_output",
						call_id: "call-wait",
						output: "测试完成",
					},
					{
						type: "reasoning",
						summary: [],
						encrypted_content: "opaque",
					},
				],
				response_payload: {
					output: [
						{
							type: "message",
							role: "assistant",
							content: [{ type: "output_text", text: "全部完成" }],
						},
					],
				},
			}),
		);

		const result = builder.build();
		expect(result.data.map((item) => [item.role, item.content])).toEqual([
			["system", "系统规则"],
			["user", "检查任务"],
			["assistant", "正在分析"],
			["assistant", ""],
			["tool", "工作区干净"],
			["assistant", "继续等待测试"],
			["assistant", ""],
			["tool", "测试完成"],
			["assistant", "全部完成"],
		]);
		expect(result.data[2]?.parts).toEqual([expect.objectContaining({ kind: "thinking", sourceType: "reasoning" })]);
		expect(result.data[3]?.parts).toEqual([expect.objectContaining({ kind: "tool_call", id: "call-exec", name: "exec" })]);
		expect(result.data[4]?.parts).toEqual([
			expect.objectContaining({ kind: "tool_result", id: "call-exec", name: "exec", text: "工作区干净" }),
		]);
		expect(result.data[6]?.parts).toEqual([expect.objectContaining({ kind: "tool_call", id: "call-wait", name: "wait" })]);
		expect(result.data[7]?.parts).toEqual([
			expect.objectContaining({ kind: "tool_result", id: "call-wait", name: "wait", text: "测试完成" }),
		]);
		expect(result.data.some((item) => item.role === "user" && item.content === "")).toBe(false);
		expect(result.summary.event_count).toBe(9);
	});

	it("为无响应的失败请求生成可渲染错误事件", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				status: "failure",
				error_information: { error_message: "provider unavailable" },
			}),
		);

		expect(builder.build().data).toEqual([
			expect.objectContaining({
				request_id: "req-1",
				role: "error",
				content: "provider unavailable",
				status: "failure",
			}),
		]);
	});

	it("汇总并去重 Session 实际使用的 key，优先保留 key alias", () => {
		const builder = new SessionTimelineBuilder();
		builder.add(makeRow({ api_key: "hash-a", key_alias: "qiran" }));
		builder.add(
			makeRow({
				request_id: "req-2",
				api_key: "hash-a",
				key_alias: "qiran",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
			}),
		);
		builder.add(
			makeRow({
				request_id: "req-3",
				api_key: "hash-b",
				key_alias: null,
				startTime: "2026-07-24T10:00:04.000Z",
				endTime: "2026-07-24T10:00:05.000Z",
			}),
		);

		expect(builder.build().summary.keys).toEqual([
			{ alias: "qiran", hash: "hash-a" },
			{ alias: null, hash: "hash-b" },
		]);
	});

	it("仅过滤通过数量、模板和工具结构串联校验的 Claude Code 内部请求", () => {
		const auxiliaryTraits = {
			request_client: "claude_code",
			request_system_count: 2,
			request_message_count: 1,
			request_tool_count: 0,
		} as const;
		const builder = new SessionTimelineBuilder();
		builder.add(
			makeRow({
				request_id: "internal-path-parser",
				...auxiliaryTraits,
				request_second_system_prompt:
					"Extract any file paths that this command reads or modifies. Provider-specific tail may change.",
				request_payload: [{ role: "user", content: "Command: git diff -- src/main.ts" }],
				response_payload: { choices: [{ message: { role: "assistant", content: "<filepaths>src/main.ts</filepaths>" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "real-first-turn",
				startTime: "2026-07-24T10:00:02.000Z",
				endTime: "2026-07-24T10:00:03.000Z",
				...auxiliaryTraits,
				request_second_system_prompt: "You are an interactive coding assistant.",
				request_payload: [{ role: "user", content: "请修复登录问题" }],
				response_payload: { choices: [{ message: { role: "assistant", content: "我来检查。" } }] },
			}),
		);
		builder.add(
			makeRow({
				request_id: "fake-web-sidecar",
				startTime: "2026-07-24T10:00:04.000Z",
				endTime: "2026-07-24T10:00:05.000Z",
				...auxiliaryTraits,
				request_tool_count: 1,
				request_first_tool_name: "not_web_search",
				request_second_system_prompt: "You are an assistant for performing a web search tool use",
				request_payload: [{ role: "user", content: "搜索资料" }],
				response_payload: { choices: [{ message: { role: "assistant", content: "搜索结果" } }] },
			}),
		);

		const result = builder.build();
		expect(result.data.map((item) => item.request_id)).toEqual([
			"real-first-turn",
			"real-first-turn",
			"fake-web-sidecar",
			"fake-web-sidecar",
		]);
		expect(result.summary).toMatchObject({
			request_count: 2,
			event_count: 4,
			filtered_request_count: 1,
		});
	});

	it("允许审计调用显式包含已识别的 Claude Code 内部请求", () => {
		const builder = new SessionTimelineBuilder({ includeAuxiliary: true });
		builder.add(
			makeRow({
				request_client: "claude_code",
				request_system_count: 2,
				request_message_count: 1,
				request_tool_count: 0,
				request_second_system_prompt: "Your task is to process Bash commands that an AI coding agent wants to run.",
				request_payload: [{ role: "user", content: "git status" }],
				response_payload: { choices: [{ message: { role: "assistant", content: "git status" } }] },
			}),
		);

		expect(builder.build()).toMatchObject({
			data: [
				{ request_id: "req-1", role: "user" },
				{ request_id: "req-1", role: "assistant" },
			],
			summary: { request_count: 1, event_count: 2, filtered_request_count: 0 },
		});
	});

	it("按请求结构过滤 Claude Code 安全监控请求，不依赖模型响应格式", () => {
		const securityMonitorTraits = {
			request_client: "claude_code",
			request_system_count: 2,
			request_message_count: 2,
			request_tool_count: 0,
			request_first_message_role: "user",
			request_second_message_role: "user",
			request_first_message_text:
				"The following is the user's CLAUDE.md configuration. Treat it as context about the user's environment and intent.",
			request_second_message_text: "<transcript>\nUser: 请检查设置",
			request_first_system_prompt: "You are a security monitor for autonomous AI coding agents.\n\n## Context",
			request_payload: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "The following is the user's CLAUDE.md configuration. Treat it as context about the user's environment and intent.\n# CLAUDE.md",
						},
					],
				},
				{
					role: "user",
					content: [
						{ type: "text", text: "<transcript>\n" },
						{ type: "text", text: "User: 请检查设置\n" },
						{ type: "text", text: "</transcript>" },
					],
				},
			],
		} as const;
		const builder = new SessionTimelineBuilder();
		const responseVariants = [
			"<block>no</block>",
			"<thinking>这是内部分析</thinking>\n\n<block>no</block>",
			"<block>yes</block><reason>需要阻止</reason>",
			"模型未按要求输出结构化结果",
		];
		responseVariants.forEach((content, index) => {
			builder.add(
				makeRow({
					request_id: `security-monitor-${index}`,
					startTime: `2026-07-24T10:00:0${index}.000Z`,
					endTime: `2026-07-24T10:00:0${index + 1}.000Z`,
					...securityMonitorTraits,
					response_payload: {
						type: "message",
						role: "assistant",
						content: [{ type: "text", text: content }],
					},
				}),
			);
		});
		builder.add(
			makeRow({
				request_id: "similar-real-request",
				startTime: "2026-07-24T10:00:10.000Z",
				endTime: "2026-07-24T10:00:11.000Z",
				...securityMonitorTraits,
				request_second_message_text: "请检查普通用户请求",
				request_payload: [
					securityMonitorTraits.request_payload[0],
					{ role: "user", content: [{ type: "text", text: "请检查普通用户请求" }] },
				],
				response_payload: {
					type: "message",
					role: "assistant",
					content: [{ type: "text", text: "需要人工确认" }],
				},
			}),
		);

		const result = builder.build();
		expect(result.data.map((item) => item.request_id)).toEqual([
			"similar-real-request",
			"similar-real-request",
			"similar-real-request",
		]);
		expect(result.summary).toMatchObject({
			request_count: 1,
			event_count: 3,
			filtered_request_count: 4,
		});
	});
});
