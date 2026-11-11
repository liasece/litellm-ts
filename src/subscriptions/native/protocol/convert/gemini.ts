/**
 * Google Gemini（generateContent / streamGenerateContent）协议编解码。
 *
 * Gemini 的工具调用没有稳定 ID，本模块在解码时生成 ID 并按工具名建立回填映射，
 * 编码时再把 ID 还原为 functionResponse 所需的 name。
 */

import type {
	CanonicalContentPart,
	CanonicalFinishReason,
	CanonicalMessage,
	CanonicalRequest,
	CanonicalRequestExtras,
	CanonicalResponse,
	CanonicalResponseFormat,
	CanonicalStreamDecoder,
	CanonicalStreamEncoder,
	CanonicalStreamEvent,
	CanonicalStreamOptions,
	CanonicalTool,
	CanonicalToolChoice,
	CanonicalUsage,
} from "../ir";
import type { ProtocolEvent } from "../types";
import {
	asRecord,
	asRecordArray,
	booleanAt,
	effortToBudget,
	finishFromGemini,
	geminiUsage,
	generateId,
	mergeAdjacentText,
	mergeUsage,
	numberAt,
	parseArgumentsObject,
	parseDataUrl,
	recordAt,
	stringAt,
	stringifyArguments,
	usageFromGemini,
} from "./shared";

/**
 * 把 data URL 或远程地址转成 Gemini 的 inlineData/fileData。
 * @param url - 图片或文件地址
 */
function geminiFilePart(url: string): Record<string, unknown> | undefined {
	const dataUrl = parseDataUrl(url);
	if (dataUrl !== undefined) {
		return { inlineData: { mimeType: dataUrl.mediaType, data: dataUrl.data } };
	}
	if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("gs://") || url.startsWith("files/")) {
		return { fileData: { fileUri: url } };
	}
	return undefined;
}

/**
 * 解码 Gemini 的 inlineData/fileData 片段。
 * @param part - Gemini part
 * @returns 规范化媒体片段；不是媒体时 undefined
 */
function decodeGeminiMediaPart(part: Record<string, unknown>): CanonicalContentPart | undefined {
	const inline = recordAt(part, "inlineData");
	if (inline !== undefined) {
		const mimeType = stringAt(inline, "mimeType") ?? "image/png";
		const data = stringAt(inline, "data") ?? "";
		const url = `data:${mimeType};base64,${data}`;
		return mimeType.startsWith("image/")
			? { type: "image", url: url }
			: { type: "document", url: url, mediaType: mimeType };
	}
	const fileData = recordAt(part, "fileData");
	if (fileData !== undefined) {
		const mimeType = stringAt(fileData, "mimeType") ?? "application/octet-stream";
		const fileUri = stringAt(fileData, "fileUri");
		if (fileUri !== undefined) {
			return mimeType.startsWith("image/")
				? { type: "image", url: fileUri }
				: { type: "document", url: fileUri, mediaType: mimeType };
		}
	}
	return undefined;
}

/**
 * 解码 Gemini parts。
 * @param parts - contents[].parts
 * @param callIds - 工具名到调用 ID 的映射，用于 functionResponse
 */
function decodeGeminiParts(parts: unknown, callIds: Map<string, string>): CanonicalContentPart[] {
	const result: CanonicalContentPart[] = [];
	for (const raw of Array.isArray(parts) ? parts : []) {
		const part = asRecord(raw);
		if (!part) {
			continue;
		}
		const text = stringAt(part, "text");
		if (text !== undefined) {
			if (booleanAt(part, "thought") === true) {
				const signature = stringAt(part, "thoughtSignature");
				if (text.length > 0 || signature !== undefined) {
					result.push({
						type: "thinking",
						text: text,
						...(signature === undefined ? {} : { signature: signature }),
					});
				}
			} else if (text.length > 0) {
				result.push({ type: "text", text: text });
			}
			continue;
		}
		const media = decodeGeminiMediaPart(part);
		if (media !== undefined) {
			result.push(media);
			continue;
		}
		const functionCall = recordAt(part, "functionCall");
		if (functionCall !== undefined) {
			const name = stringAt(functionCall, "name") ?? "";
			const id = stringAt(functionCall, "id") ?? generateId("call");
			if (name.length > 0) {
				callIds.set(name, id);
				const signature = stringAt(part, "thoughtSignature");
				result.push({
					type: "tool_call",
					id: id,
					name: name,
					arguments: stringifyArguments(functionCall["args"]),
					...(signature === undefined ? {} : { signature: signature }),
				});
			}
			continue;
		}
		const functionResponse = recordAt(part, "functionResponse");
		if (functionResponse !== undefined) {
			const name = stringAt(functionResponse, "name") ?? "";
			const id = stringAt(functionResponse, "id") ?? callIds.get(name) ?? generateId("call");
			const response = functionResponse["response"];
			const responseRecord = asRecord(response);
			const textContent =
				typeof response === "string"
					? response
					: responseRecord === undefined
						? stringifyArguments(response)
						: (() => {
								const output = stringAt(responseRecord, "result", "output", "content", "error");
								return output ?? stringifyArguments(response);
							})();
			const isError =
				responseRecord !== undefined && (responseRecord["error"] !== undefined || responseRecord["success"] === false);
			const content: CanonicalContentPart[] = [{ type: "text", text: textContent }];
			for (const nested of asRecordArray(functionResponse["parts"])) {
				const media = decodeGeminiMediaPart(nested);
				if (media !== undefined) {
					content.push(media);
				}
			}
			result.push({
				type: "tool_result",
				toolCallId: id,
				content: content,
				...(isError ? { isError: true } : {}),
			});
			continue;
		}
		// executableCode、codeExecutionResult 等内建能力无法跨协议表达，安全忽略。
	}
	return result;
}

/**
 * 解码 Gemini systemInstruction。
 * @param value - systemInstruction 字段
 */
function decodeGeminiSystem(value: unknown): CanonicalContentPart[] {
	const record = asRecord(value);
	if (!record) {
		return typeof value === "string" && value.length > 0 ? [{ type: "text", text: value }] : [];
	}
	return decodeGeminiParts(record["parts"], new Map<string, string>());
}

/**
 * 合并相邻同角色消息。
 * @param messages - 待合并消息
 */
function mergeByRole(messages: CanonicalMessage[]): CanonicalMessage[] {
	const merged: CanonicalMessage[] = [];
	for (const message of messages) {
		const previous = merged.at(-1);
		if (previous !== undefined && previous.role === message.role) {
			merged[merged.length - 1] = {
				role: previous.role,
				parts: [...previous.parts, ...message.parts],
				...(previous.cacheControl === undefined ? {} : { cacheControl: previous.cacheControl }),
			};
			continue;
		}
		merged.push(message);
	}
	return merged;
}

/**
 * 解码 Gemini 工具定义。
 * @param value - tools 字段
 */
export function decodeGeminiTools(value: unknown): CanonicalTool[] {
	const tools: CanonicalTool[] = [];
	for (const raw of asRecordArray(value)) {
		for (const declaration of asRecordArray(raw["functionDeclarations"] ?? raw["function_declarations"])) {
			const name = stringAt(declaration, "name");
			if (name === undefined || name.length === 0) {
				continue;
			}
			const rawParameters = declaration["parameters"] ?? declaration["parametersJsonSchema"];
			let parameters = recordAt(declaration, "parameters", "parametersJsonSchema");
			if (typeof rawParameters === "string") {
				const parsed = safeJsonParse(rawParameters);
				parameters = asRecord(parsed) ?? parameters;
			}
			const description = stringAt(declaration, "description");
			tools.push({
				name: name,
				...(description === undefined ? {} : { description: description }),
				...(parameters === undefined ? {} : { parameters: parameters }),
			});
		}
	}
	return tools;
}

/**
 * 解码 Gemini 工具选择。
 * @param value - toolConfig.functionCallingConfig
 */
export function decodeGeminiToolChoice(value: unknown): CanonicalToolChoice | undefined {
	const config = recordAt(asRecord(value), "functionCallingConfig") ?? asRecord(value);
	if (!config) {
		return undefined;
	}
	const mode = stringAt(config, "mode")?.toUpperCase();
	const allowed: string[] = [];
	for (const name of Array.isArray(config["allowedFunctionNames"]) ? config["allowedFunctionNames"] : []) {
		if (typeof name === "string") {
			allowed.push(name);
		}
	}
	if (mode === "NONE") {
		return { mode: "none" };
	}
	if (mode === "ANY") {
		return {
			mode: "required",
			...(allowed.length === 0 ? {} : { allowedNames: allowed }),
		};
	}
	if (mode === "AUTO") {
		return { mode: "auto", ...(allowed.length === 0 ? {} : { allowedNames: allowed }) };
	}
	return undefined;
}

/**
 * 解码 Gemini 结构化输出。
 * @param config - generationConfig
 */
function decodeGeminiResponseFormat(
	config: Record<string, unknown> | undefined,
): CanonicalResponseFormat | undefined {
	const mimeType = stringAt(config, "responseMimeType");
	const schema = config?.["responseSchema"] ?? config?.["responseJsonSchema"];
	if (mimeType === "application/json" || schema !== undefined) {
		if (schema !== undefined) {
			return { type: "json_schema", schema: schema };
		}
		return { type: "json_object" };
	}
	return undefined;
}

/**
 * 解码 Gemini 请求。
 * @param body - Gemini 请求体
 * @param fallbackModel - 请求体缺少 model 时使用
 */
export function decodeGeminiRequest(body: Record<string, unknown>, fallbackModel: string): CanonicalRequest {
	const system = decodeGeminiSystem(body["systemInstruction"] ?? body["system_instruction"]);
	const messages: CanonicalMessage[] = [];
	const callIds = new Map<string, string>();
	for (const raw of asRecordArray(body["contents"])) {
		const role = stringAt(raw, "role");
		const parts = decodeGeminiParts(raw["parts"], callIds);
		if (parts.length === 0) {
			continue;
		}
		messages.push({ role: role === "model" ? "assistant" : "user", parts: parts });
	}
	const config = recordAt(body, "generationConfig") ?? recordAt(body, "generation_config");
	const thinking = recordAt(config, "thinkingConfig") ?? recordAt(config, "thinking_config");
	const thinkingBudget = numberAt(thinking, "thinkingBudget", "thinking_budget");
	const thinkingLevel = stringAt(thinking, "thinkingLevel", "thinking_level");
	const maxTokens = numberAt(config, "maxOutputTokens", "max_output_tokens");
	const temperature = numberAt(config, "temperature");
	const topP = numberAt(config, "topP", "top_p");
	const topK = numberAt(config, "topK", "top_k");
	const candidateCount = numberAt(config, "candidateCount", "candidate_count");
	const seed = numberAt(config, "seed");
	const presencePenalty = numberAt(config, "presencePenalty", "presence_penalty");
	const frequencyPenalty = numberAt(config, "frequencyPenalty", "frequency_penalty");
	const stop = Array.isArray(config?.["stopSequences"])
		? (config?.["stopSequences"] as unknown[]).filter((item): item is string => typeof item === "string")
		: [];
	const safetySettings = Array.isArray(body["safetySettings"])
		? (body["safetySettings"] as unknown[]).filter(
				(item): item is Record<string, unknown> => asRecord(item) !== undefined,
			)
		: undefined;
	const responseModalities = Array.isArray(config?.["responseModalities"])
		? (config?.["responseModalities"] as unknown[]).filter((item): item is string => typeof item === "string")
		: undefined;
	const extras: CanonicalRequestExtras = {
		...(seed === undefined ? {} : { seed: seed }),
		...(candidateCount === undefined ? {} : { candidateCount: candidateCount }),
		...(presencePenalty === undefined ? {} : { presencePenalty: presencePenalty }),
		...(frequencyPenalty === undefined ? {} : { frequencyPenalty: frequencyPenalty }),
		...(stringAt(body, "cachedContent", "cached_content") === undefined
			? {}
			: { cachedContent: stringAt(body, "cachedContent", "cached_content") }),
		...(safetySettings === undefined ? {} : { safetySettings: safetySettings }),
		...(responseModalities === undefined ? {} : { responseModalities: responseModalities }),
	};
	const toolChoice = decodeGeminiToolChoice(body["toolConfig"]);
	const format = decodeGeminiResponseFormat(config);
	return {
		model: (stringAt(body, "model") ?? fallbackModel).replace(/^models\//, ""),
		system: system,
		messages: mergeByRole(messages),
		tools: decodeGeminiTools(body["tools"]),
		...(toolChoice === undefined ? {} : { toolChoice: toolChoice }),
		...(maxTokens === undefined ? {} : { maxTokens: maxTokens }),
		...(temperature === undefined ? {} : { temperature: temperature }),
		...(topP === undefined ? {} : { topP: topP }),
		...(topK === undefined ? {} : { topK: topK }),
		stop: stop,
		...(thinkingBudget === undefined && thinkingLevel === undefined
			? {}
			: {
					reasoning: {
						enabled: thinkingBudget !== 0,
						...(thinkingBudget === undefined ? {} : { budgetTokens: thinkingBudget }),
						...(thinkingLevel === undefined ? {} : { effort: thinkingLevel.toLowerCase() }),
					},
				}),
		...(format === undefined ? {} : { responseFormat: format }),
		extras: extras,
	};
}

/**
 * 编码 Gemini 函数响应体。
 * @param part - 工具结果片段
 * @param toolNames - 工具调用 ID 到名称的映射
 */
function encodeFunctionResponse(
	part: CanonicalContentPart,
	toolNames: Map<string, string>,
): Record<string, unknown> | undefined {
	const textParts =
		part.type === "tool_result"
			? part.content.map((item) => (item.type === "text" ? item.text : "")).filter((text) => text.length > 0)
			: [];
	const joined = textParts.join("");
	const name = toolNames.get(part.type === "tool_result" ? part.toolCallId : "");
	if (name === undefined) {
		// 找不到对应函数调用时无法构造 functionResponse，退回普通文本。
		return joined.length > 0 ? { text: joined } : undefined;
	}
	const parsed = asRecord(safeJsonParse(joined));
	const response =
		parsed ?? {
			[part.type === "tool_result" && part.isError === true ? "error" : "result"]: joined.length > 0 ? joined : "",
		};
	const mediaParts: Record<string, unknown>[] = [];
	if (part.type === "tool_result") {
		for (const item of part.content) {
			const url = item.type === "image" || item.type === "document" ? item.url : undefined;
			if (url === undefined) {
				continue;
			}
			const encoded = geminiFilePart(url);
			if (encoded !== undefined) {
				mediaParts.push(encoded);
			}
		}
	}
	return {
		functionResponse: {
			id: part.type === "tool_result" ? part.toolCallId : "",
			name: name,
			response: response,
			...(mediaParts.length === 0 ? {} : { parts: mediaParts }),
		},
	};
}

/**
 * 安全解析 JSON。
 * @param text - JSON 文本
 */
function safeJsonParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/**
 * 编码 Gemini parts。
 * @param parts - 规范内容片段
 * @param toolNames - 工具调用 ID 到名称的映射
 */
function encodeGeminiParts(
	parts: readonly CanonicalContentPart[],
	toolNames: Map<string, string>,
): Record<string, unknown>[] {
	const result: Record<string, unknown>[] = [];
	for (const part of mergeAdjacentText(parts)) {
		switch (part.type) {
			case "text": {
				if (part.text.length > 0) {
					result.push({ text: part.text });
				}
				break;
			}
			case "image": {
				const filePart = geminiFilePart(part.url);
				if (filePart) {
					result.push(filePart);
				}
				break;
			}
			case "document": {
				if (part.text !== undefined) {
					const text = part.title === undefined ? part.text : `${part.title}\n\n${part.text}`;
					result.push({ text: text });
				} else if (part.fileId !== undefined) {
					result.push({ fileData: { fileUri: part.fileId } });
				} else if (part.url !== undefined) {
					const filePart = geminiFilePart(part.url);
					if (filePart) {
						result.push(filePart);
					}
				}
				break;
			}
			case "thinking": {
				// Gemini 只接受带签名的思考回放。
				if (part.signature !== undefined && part.signature.length > 0) {
					result.push({
						text: part.text,
						thought: true,
						thoughtSignature: part.signature,
					});
				}
				break;
			}
			case "refusal": {
				if (part.text.length > 0) {
					result.push({ text: part.text });
				}
				break;
			}
			case "tool_call": {
				toolNames.set(part.id, part.name);
				result.push({
					...(part.signature === undefined ? {} : { thoughtSignature: part.signature }),
					functionCall: {
						id: part.id,
						name: part.name,
						args: parseArgumentsObject(part.arguments),
					},
				});
				break;
			}
			case "tool_result": {
				const encoded = encodeFunctionResponse(part, toolNames);
				if (encoded !== undefined) {
					result.push(encoded);
				}
				break;
			}
			default:
				break;
		}
	}
	return result;
}

/**
 * 编码 Gemini 工具定义。
 * @param tools - 规范工具
 */
function encodeGeminiTools(tools: readonly CanonicalTool[]): Record<string, unknown>[] {
	const declarations = tools.map((tool) => ({
		name: tool.name,
		...(tool.description === undefined ? {} : { description: tool.description }),
		parameters: tool.parameters === undefined ? { type: "object", properties: {} } : tool.parameters,
	}));
	return declarations.length === 0 ? [] : [{ functionDeclarations: declarations }];
}

/**
 * 编码 Gemini 工具选择。
 * @param choice - 规范工具选择
 */
function encodeGeminiToolChoice(choice: CanonicalToolChoice | undefined): Record<string, unknown> | undefined {
	if (!choice) {
		return undefined;
	}
	if (choice.mode === "none") {
		return { functionCallingConfig: { mode: "NONE" } };
	}
	if (choice.mode === "required" || choice.mode === "tool") {
		const allowed =
			choice.mode === "tool" && choice.name !== undefined
				? [choice.name]
				: choice.allowedNames === undefined
					? undefined
					: [...choice.allowedNames];
		return {
			functionCallingConfig: {
				mode: "ANY",
				...(allowed === undefined || allowed.length === 0
					? {}
					: { allowedFunctionNames: allowed }),
			},
		};
	}
	if (choice.allowedNames !== undefined) {
		if (choice.allowedNames.length === 0) {
			return { functionCallingConfig: { mode: "NONE" } };
		}
		return { functionCallingConfig: { mode: "AUTO" } };
	}
	return { functionCallingConfig: { mode: "AUTO" } };
}

/**
 * 编码 Gemini 请求。
 * @param request - 规范请求
 * @param upstreamModel - 上游模型 ID
 */
export function encodeGeminiRequest(request: CanonicalRequest, upstreamModel: string): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model: upstreamModel.replace(/^models\//, ""),
	};
	const systemParts: Record<string, unknown>[] = [];
	for (const part of request.system) {
		if (part.type === "text" && part.text.length > 0) {
			systemParts.push({ text: part.text });
		}
	}
	for (const message of request.messages) {
		if (message.role !== "system") {
			continue;
		}
		for (const part of message.parts) {
			if (part.type === "text" && part.text.length > 0) {
				systemParts.push({ text: part.text });
			}
		}
	}
	if (systemParts.length > 0) {
		body["systemInstruction"] = { parts: systemParts };
	}
	const toolNames = new Map<string, string>();
	const contents: Record<string, unknown>[] = [];
	for (const message of request.messages) {
		if (message.role === "system") {
			continue;
		}
		const parts = encodeGeminiParts(message.parts, toolNames);
		if (parts.length === 0) {
			continue;
		}
		const role = message.role === "assistant" ? "model" : "user";
		const previous = contents.at(-1);
		if (previous !== undefined && previous["role"] === role && Array.isArray(previous["parts"])) {
			previous["parts"] = [...(previous["parts"] as unknown[]), ...parts];
			continue;
		}
		contents.push({ role: role, parts: parts });
	}
	if (contents.length === 0) {
		contents.push({ role: "user", parts: [{ text: "" }] });
	}
	body["contents"] = contents;
	const allowedNames =
		request.toolChoice?.mode === "auto" ? request.toolChoice.allowedNames : undefined;
	const selectedTools =
		allowedNames === undefined
			? request.tools
			: request.tools.filter((tool) => allowedNames.includes(tool.name));
	const tools = encodeGeminiTools(selectedTools);
	if (tools.length > 0) {
		body["tools"] = tools;
	}
	const toolConfig = encodeGeminiToolChoice(request.toolChoice);
	if (toolConfig !== undefined) {
		body["toolConfig"] = toolConfig;
	}
	const config: Record<string, unknown> = {};
	if (request.maxTokens !== undefined) {
		config["maxOutputTokens"] = request.maxTokens;
	}
	if (request.temperature !== undefined) {
		config["temperature"] = request.temperature;
	}
	if (request.topP !== undefined) {
		config["topP"] = request.topP;
	}
	if (request.topK !== undefined) {
		config["topK"] = request.topK;
	}
	if (request.stop.length > 0) {
		config["stopSequences"] = [...request.stop];
	}
	if (request.extras.candidateCount !== undefined) {
		config["candidateCount"] = request.extras.candidateCount;
	}
	if (request.extras.seed !== undefined) {
		config["seed"] = request.extras.seed;
	}
	if (request.extras.presencePenalty !== undefined) {
		config["presencePenalty"] = request.extras.presencePenalty;
	}
	if (request.extras.frequencyPenalty !== undefined) {
		config["frequencyPenalty"] = request.extras.frequencyPenalty;
	}
	if (request.extras.responseModalities !== undefined) {
		config["responseModalities"] = [...request.extras.responseModalities];
	}
	const format = request.responseFormat;
	if (format?.type === "json_object") {
		config["responseMimeType"] = "application/json";
	} else if (format?.type === "json_schema") {
		config["responseMimeType"] = "application/json";
		if (format.schema !== undefined) {
			config["responseSchema"] = format.schema;
		}
	}
	const reasoning = request.reasoning;
	if (reasoning !== undefined) {
		const budget =
			reasoning.budgetTokens ??
			(reasoning.effort === undefined ? undefined : effortToBudget(reasoning.effort));
		config["thinkingConfig"] = {
			...(reasoning.enabled === false ? { thinkingBudget: 0 } : {}),
			...(budget === undefined || reasoning.enabled === false ? {} : { thinkingBudget: budget }),
			...(reasoning.enabled === false ? {} : { includeThoughts: true }),
		};
	}
	if (Object.keys(config).length > 0) {
		body["generationConfig"] = config;
	}
	if (request.extras.safetySettings !== undefined) {
		body["safetySettings"] = request.extras.safetySettings;
	}
	if (request.extras.cachedContent !== undefined) {
		body["cachedContent"] = request.extras.cachedContent;
	}
	return body;
}

/**
 * 解码 Gemini 响应。
 * @param body - Gemini 响应体
 * @param fallbackModel - 响应缺少 model 时使用
 */
export function decodeGeminiResponse(body: Record<string, unknown>, fallbackModel: string): CanonicalResponse {
	const candidates = asRecordArray(body["candidates"]);
	const candidate = candidates[0];
	const content = recordAt(candidate, "content");
	const callIds = new Map<string, string>();
	const parts = decodeGeminiParts(content?.["parts"], callIds);
	const hasToolCalls = parts.some((part) => part.type === "tool_call");
	const finishReasonRaw = stringAt(candidate, "finishReason");
	const finishReason: CanonicalFinishReason =
		finishReasonRaw === undefined
			? promptBlockReason(body) ?? (hasToolCalls ? "tool_calls" : "stop")
			: hasToolCalls && finishReasonRaw === "STOP"
				? "tool_calls"
				: finishFromGemini(finishReasonRaw);
	return {
		id: stringAt(body, "responseId") ?? generateId("gemini"),
		createdAt: Math.floor(Date.now() / 1000),
		model: stringAt(body, "modelVersion") ?? fallbackModel,
		parts: parts,
		finishReason: finishReason,
		usage: usageFromGemini(recordAt(body, "usageMetadata")),
	};
}

/**
 * 从 promptFeedback 判断是否被安全策略拦截。
 * @param body - Gemini 响应体
 */
function promptBlockReason(body: Record<string, unknown>): CanonicalFinishReason | undefined {
	const feedback = recordAt(body, "promptFeedback");
	const blockReason = stringAt(feedback, "blockReason");
	return blockReason === undefined ? undefined : "content_filter";
}

/**
 * 编码 Gemini 响应。
 * @param response - 规范响应
 * @param model - 对外模型 ID
 */
export function encodeGeminiResponse(response: CanonicalResponse, model: string): Record<string, unknown> {
	const parts: Record<string, unknown>[] = [];
	for (const part of mergeAdjacentText(response.parts)) {
		switch (part.type) {
			case "text": {
				if (part.text.length > 0) {
					parts.push({ text: part.text });
				}
				break;
			}
			case "image": {
				const filePart = geminiFilePart(part.url);
				if (filePart) {
					parts.push(filePart);
				}
				break;
			}
			case "document": {
				if (part.text !== undefined) {
					parts.push({ text: part.text });
				}
				break;
			}
			case "thinking": {
				if (part.text.length > 0) {
					parts.push({
						text: part.text,
						thought: true,
						...(part.signature === undefined ? {} : { thoughtSignature: part.signature }),
					});
				}
				break;
			}
			case "refusal": {
				parts.push({ text: part.text });
				break;
			}
			case "tool_call": {
				parts.push({
					...(part.signature === undefined ? {} : { thoughtSignature: part.signature }),
					functionCall: {
						id: part.id,
						name: part.name,
						args: parseArgumentsObject(part.arguments),
					},
				});
				break;
			}
			case "tool_result": {
				break;
			}
			default:
				break;
		}
	}
	return {
		responseId: response.id,
		modelVersion: model,
		candidates: [
			{
				content: { role: "model", parts: parts },
				finishReason: encodeGeminiFinishReason(response.finishReason),
				index: 0,
			},
		],
		usageMetadata: geminiUsage(response.usage),
	};
}

/**
 * 规范结束原因转 Gemini。
 * @param reason - 规范结束原因
 */
function encodeGeminiFinishReason(reason: CanonicalFinishReason): string {
	switch (reason) {
		case "length":
			return "MAX_TOKENS";
		case "content_filter":
			return "SAFETY";
		case "error":
			return "OTHER";
		default:
			return "STOP";
	}
}

/**
 * Gemini 是否以 SSE 返回。
 * @param contentType - 响应 Content-Type
 */
export function isGeminiSseContentType(contentType: string | undefined): boolean {
	return contentType?.includes("text/event-stream") === true;
}

/**
 * Gemini SSE 解码器。
 */
export class GeminiStreamDecoder implements CanonicalStreamDecoder {
	private readonly _options: CanonicalStreamOptions;
	private _started = false;
	private _finished = false;
	private _usage: CanonicalUsage | undefined;
	private _toolCounter = 0;

	constructor(options: CanonicalStreamOptions) {
		this._options = options;
	}

	/**
	 * 解码一条上游 SSE 事件。
	 * @param event - 上游事件
	 */
	decode(event: ProtocolEvent): CanonicalStreamEvent[] {
		if (typeof event.data === "string") {
			return [];
		}
		const payload = event.data;
		const events: CanonicalStreamEvent[] = [];
		if (payload["error"] !== undefined) {
			const error = recordAt(payload, "error");
			events.push({
				type: "error",
				errorType: stringAt(error, "status", "code") ?? "api_error",
				message: stringAt(error, "message") ?? "上游流式响应失败",
			});
			return events;
		}
		if (!this._started) {
			this._started = true;
			events.push({
				type: "start",
				id: stringAt(payload, "responseId") ?? generateId("gemini"),
				model: stringAt(payload, "modelVersion") ?? this._options.upstreamModel,
				createdAt: Math.floor(Date.now() / 1000),
			});
		}
		const usage = recordAt(payload, "usageMetadata");
		if (usage !== undefined) {
			this._usage = mergeUsage(this._usage, usageFromGemini(usage));
			events.push({ type: "usage", usage: this._usage });
		}
		const candidates = asRecordArray(payload["candidates"]);
		const candidate = candidates[0];
		if (candidate !== undefined) {
			const content = recordAt(candidate, "content");
			const callIds = new Map<string, string>();
			const parts = decodeGeminiParts(content?.["parts"], callIds);
			for (const part of parts) {
				if (part.type === "text") {
					events.push({ type: "text_delta", text: part.text });
				} else if (part.type === "thinking") {
					events.push({ type: "thinking_delta", text: part.text });
					if (part.signature !== undefined) {
						events.push({ type: "thinking_signature", signature: part.signature });
					}
				} else if (part.type === "tool_call") {
					const index = this._toolCounter++;
					events.push({
						type: "tool_call_start",
						index: index,
						id: part.id,
						name: part.name,
					});
					if (part.arguments.length > 0) {
						events.push({ type: "tool_call_arguments", index: index, delta: part.arguments });
					}
					events.push({ type: "tool_call_stop", index: index });
				}
			}
			const finishReasonRaw = stringAt(candidate, "finishReason");
			if (finishReasonRaw !== undefined && !this._finished) {
				this._finished = true;
				const hasTools = parts.some((part) => part.type === "tool_call");
				events.push({
					type: "finish",
					reason:
						hasTools && finishReasonRaw === "STOP"
							? "tool_calls"
							: finishFromGemini(finishReasonRaw),
				});
			}
		}
		const blockReason = stringAt(recordAt(payload, "promptFeedback"), "blockReason");
		if (blockReason !== undefined && !this._finished) {
			this._finished = true;
			events.push({ type: "finish", reason: "content_filter" });
		}
		return events;
	}
}

/**
 * Gemini SSE 编码器。
 */
export class GeminiStreamEncoder implements CanonicalStreamEncoder {
	private readonly _options: CanonicalStreamOptions;
	private _model = "";
	private _responseId = "";
	private _started = false;
	private _terminal = false;
	private _usage: CanonicalUsage | undefined;
	private readonly _toolBuffers = new Map<number, { name: string; arguments: string; closed: boolean }>();
	private readonly _toolOrder: number[] = [];
	private _finishReason: CanonicalFinishReason | undefined;

	constructor(options: CanonicalStreamOptions) {
		this._options = options;
	}

	/**
	 * 编码一条规范流事件。
	 * @param event - 规范事件
	 */
	encode(event: CanonicalStreamEvent): ProtocolEvent[] {
		if (this._terminal) {
			return [];
		}
		switch (event.type) {
			case "start": {
				this._model = this._options.model;
				this._responseId = event.id;
				if (event.usage !== undefined) {
					this._usage = event.usage;
				}
				const frames = this._ensureStarted();
				return frames;
			}
			case "text_delta": {
				const frames = this._ensureStarted();
				frames.push(this._chunk([{ text: event.text }], undefined));
				return frames;
			}
			case "refusal_delta": {
				const frames = this._ensureStarted();
				frames.push(this._chunk([{ text: event.text }], undefined));
				return frames;
			}
			case "thinking_delta": {
				const frames = this._ensureStarted();
				frames.push(this._chunk([{ text: event.text, thought: true }], undefined));
				return frames;
			}
			case "thinking_signature": {
				return [];
			}
			case "tool_call_start": {
				const frames = this._ensureStarted();
				this._toolBuffers.set(event.index, { name: event.name, arguments: "", closed: false });
				this._toolOrder.push(event.index);
				return frames;
			}
			case "tool_call_arguments": {
				const buffer = this._toolBuffers.get(event.index);
				if (buffer !== undefined) {
					buffer.arguments += event.delta;
				}
				return [];
			}
			case "tool_call_stop": {
				const frames: ProtocolEvent[] = [];
				const buffer = this._toolBuffers.get(event.index);
				if (buffer === undefined || buffer.closed) {
					return frames;
				}
				buffer.closed = true;
				frames.push(
					this._chunk(
						[
							{
								functionCall: {
									name: buffer.name,
									args: parseArgumentsObject(buffer.arguments),
								},
							},
						],
						undefined,
					),
				);
				return frames;
			}
			case "usage": {
				this._usage = event.usage;
				return [];
			}
			case "finish": {
				if (this._finishReason !== undefined) {
					return [];
				}
				this._finishReason = event.reason;
				// 终止帧延迟到 flush，等待可能紧随其后的 usage 分片。
				return [...this._ensureStarted(), ...this._flushToolBuffers()];
			}
			case "error": {
				const frames = this._ensureStarted();
				frames.push({
					data: { error: { code: 500, message: event.message, status: event.errorType } },
				});
				this._terminal = true;
				return frames;
			}
			case "ping":
				return [];
			default:
				return [];
		}
	}

	/**
	 * 冲刷终止帧。
	 */
	flush(): ProtocolEvent[] {
		if (this._terminal) {
			return [];
		}
		const frames = this._ensureStarted();
		frames.push(...this._flushToolBuffers());
		frames.push(this._chunk([], encodeGeminiFinishReason(this._finishReason ?? "stop")));
		this._terminal = true;
		return frames;
	}

	private _ensureStarted(): ProtocolEvent[] {
		if (this._started) {
			return [];
		}
		this._started = true;
		if (this._model.length === 0) {
			this._model = this._options.model;
		}
		if (this._responseId.length === 0) {
			this._responseId = generateId("gemini");
		}
		return [];
	}

	private _flushToolBuffers(): ProtocolEvent[] {
		const frames: ProtocolEvent[] = [];
		for (const index of this._toolOrder) {
			const buffer = this._toolBuffers.get(index);
			if (buffer === undefined || buffer.closed) {
				continue;
			}
			buffer.closed = true;
			frames.push(
				this._chunk(
					[
						{
							functionCall: {
								name: buffer.name,
								args: parseArgumentsObject(buffer.arguments),
							},
						},
					],
					undefined,
				),
			);
		}
		return frames;
	}

	private _chunk(parts: Record<string, unknown>[], finishReason: string | undefined): ProtocolEvent {
		return {
			data: {
				candidates: [
					{
						content: { role: "model", parts: parts },
						...(finishReason === undefined ? {} : { finishReason: finishReason }),
						index: 0,
					},
				],
				...(this._responseId.length === 0 ? {} : { responseId: this._responseId }),
				...(this._model.length === 0 ? {} : { modelVersion: this._model }),
				...(this._usage === undefined ? {} : { usageMetadata: geminiUsage(this._usage) }),
			},
		};
	}
}

/**
 * 创建 Gemini 流解码器。
 * @param options - 流式选项
 */
export function createGeminiStreamDecoder(options: CanonicalStreamOptions): CanonicalStreamDecoder {
	return new GeminiStreamDecoder(options);
}

/**
 * 创建 Gemini 流编码器。
 * @param options - 流式选项
 */
export function createGeminiStreamEncoder(options: CanonicalStreamOptions): CanonicalStreamEncoder {
	return new GeminiStreamEncoder(options);
}
