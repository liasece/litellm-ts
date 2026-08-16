/**
 * RequestMetaTags - pretty 视图顶部的请求元信息 tag 行
 * 展示思考强度、工具列表、temperature 等请求级关键参数。
 */

import { Tag } from "antd";
import { RequestMeta } from "./prettyMessagesTypes";

interface RequestMetaTagsProps {
	meta: RequestMeta;
}

/** 工具列表 tag 最多展示的名字数量，超出以 "+N" 收尾，完整列表见 Tools 区块 */
const MAX_TOOL_NAMES = 3;

export function RequestMetaTags({ meta }: RequestMetaTagsProps) {
	const hasMeta =
		meta.reasoningEffort !== undefined ||
		meta.thinkingBudget !== undefined ||
		meta.tools.length > 0 ||
		meta.temperature !== undefined ||
		meta.topP !== undefined ||
		meta.maxTokens !== undefined ||
		meta.stream !== undefined;

	if (!hasMeta) return null;

	const toolNames = meta.tools.slice(0, MAX_TOOL_NAMES).join(", ");
	const remainingTools = meta.tools.length - MAX_TOOL_NAMES;

	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
			{meta.stream && (
				<Tag color="geekblue" style={{ margin: 0 }}>
					streaming
				</Tag>
			)}
			{meta.reasoningEffort !== undefined && (
				<Tag color="purple" style={{ margin: 0 }}>
					Reasoning: {meta.reasoningEffort}
				</Tag>
			)}
			{meta.thinkingBudget !== undefined && (
				<Tag color="purple" style={{ margin: 0 }}>
					Thinking budget: {meta.thinkingBudget} tokens
				</Tag>
			)}
			{meta.tools.length > 0 && (
				<Tag color="blue" style={{ margin: 0 }}>
					Tools: {toolNames}
					{remainingTools > 0 ? ` +${remainingTools}` : ""}
				</Tag>
			)}
			{meta.temperature !== undefined && <Tag style={{ margin: 0 }}>temperature: {meta.temperature}</Tag>}
			{meta.topP !== undefined && <Tag style={{ margin: 0 }}>top_p: {meta.topP}</Tag>}
			{meta.maxTokens !== undefined && <Tag style={{ margin: 0 }}>max_tokens: {meta.maxTokens}</Tag>}
		</div>
	);
}
