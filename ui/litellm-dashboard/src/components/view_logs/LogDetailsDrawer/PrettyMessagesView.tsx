/**
 * PrettyMessagesView - Datadog-style view with Input/Output cards
 * Two main cards showing request and response with token counts and costs.
 * Detects realtime API responses and renders a specialized view.
 */

import { memo, useMemo } from "react";
import { hasRequestMetaBody, parseRequestMessages, parseResponseMessage, parseRequestMeta } from "./prettyMessagesUtils";
import { InputCard } from "./InputCard";
import { OutputCard } from "./OutputCard";
import { RequestMetaTags } from "./RequestMetaTags";
import { isRealtimeResponse, RealtimePrettyView } from "./RealtimePrettyView";

interface PrettyMessagesViewProps {
	request: any;
	response: any;
	/**
	 * 上游请求（Provider 转换后真正发出的请求）。
	 * Tag 行按上游请求取值，仅在上游日志缺失时回退到 request。
	 */
	metaRequest?: any;
	metrics?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		input_cost?: number;
		output_cost?: number;
	};
}

export function PrettyMessagesView(props: PrettyMessagesViewProps) {
	if (isRealtimeResponse(props.response)) {
		return <RealtimePrettyView response={props.response} metrics={props.metrics} />;
	}
	return <MessagesPrettyView {...props} />;
}

/** 请求侧卡片与标签在流式期间不变，memo 后不会跟着响应刷新重渲染。 */
const MemoizedInputCard = memo(InputCard);
const MemoizedRequestMetaTags = memo(RequestMetaTags);

function MessagesPrettyView({ request, response, metrics, metaRequest }: PrettyMessagesViewProps) {
	// 请求消息只在请求变化时重算；响应消息跟着响应走。
	const requestMessages = useMemo(() => parseRequestMessages(request), [request]);
	const responseMessage = useMemo(() => parseResponseMessage(response), [response]);
	// 思考强度等参数可能由代理按模型配置注入，只存在于上游请求中；
	// 上游日志关闭时（无 upstream 请求体）回退到下游请求，避免标签整体消失。
	// 顶部 tag 与 Input 卡片内的 Tools 列表取同一来源，保证工具数量与名称一致。
	const metaSource = metaRequest && hasRequestMetaBody(metaRequest) ? metaRequest : request;
	const requestMeta = useMemo(() => parseRequestMeta(metaSource), [metaSource]);

	return (
		<div>
			{/* Request metadata tags */}
			<MemoizedRequestMetaTags meta={requestMeta} />

			{/* Input Card */}
			<MemoizedInputCard
				messages={requestMessages}
				tools={requestMeta.tools}
				promptTokens={metrics?.prompt_tokens}
				inputCost={metrics?.input_cost}
			/>

			{/* Output Card */}
			<OutputCard
				message={responseMessage}
				completionTokens={metrics?.completion_tokens}
				outputCost={metrics?.output_cost}
			/>
		</div>
	);
}
