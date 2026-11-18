/**
 * 上游模型信息的进程级入口。
 *
 * 服务实例由容器创建（需要数据库与账号仓库），但模型信息合并、费用兜底和请求侧上限
 * 校验分散在 Router、ModelsEndpoint、bridge 等模块里。与其把这些构造器逐层改签名，
 * 这里保留一个进程级引用：容器建好后注册，其他模块按需取用；未注册时（例如单元测试
 * 或只读工具）所有调用都返回 undefined，行为与没有该功能时完全一致。
 */

import type { SubscriptionSource } from "../types";
import type { UpstreamModelInfoService } from "./service";
import type { UpstreamModelMetadata } from "./types";
import type { UpstreamModelRef } from "./lookup";

/** 当前进程注册的服务实例。 */
let activeService: UpstreamModelInfoService | undefined;

/**
 * 注册服务实例；容器初始化时调用。
 * @param service - 服务实例
 */
export function registerUpstreamModelInfoService(service: UpstreamModelInfoService): void {
	activeService = service;
}

/** 注销服务实例（测试与进程收尾用）。 */
export function resetUpstreamModelInfoService(): void {
	activeService = undefined;
}

/** 取当前服务实例；未注册时 undefined。 */
export function getUpstreamModelInfoService(): UpstreamModelInfoService | undefined {
	return activeService;
}

/**
 * 取某个上游模型当前的归一化元信息（只读内存，不触发等待）。
 * @param source - 来源
 * @param modelId - 上游模型 ID
 */
export function upstreamMetadataFor(source: UpstreamModelRef["source"], modelId: string): UpstreamModelMetadata | undefined {
	return activeService?.metadata(source, modelId);
}

/**
 * 按部署取上游元信息。
 * @param ref - 部署解析出的上游键
 */
export function upstreamMetadataForRef(ref: UpstreamModelRef | undefined): UpstreamModelMetadata | undefined {
	return ref === undefined ? undefined : upstreamMetadataFor(ref.source, ref.upstreamModel);
}

/** 上游价格与抓取时间的快照键（写 spend 日志用）。 */
export interface UpstreamModelSnapshot {
	/** 订阅来源。 */
	readonly source: SubscriptionSource;
	/** 上游模型 ID。 */
	readonly upstreamModel: string;
	/** 抓取时间（ISO 字符串）。 */
	readonly fetchedAt: string;
	/** 归一化元信息。 */
	readonly metadata: UpstreamModelMetadata;
}

/**
 * 按部署取上游缓存快照（含抓取时间）。写费用日志时冻结价格用；
 * 未注册服务或没有命中时返回 undefined。
 * @param ref - 部署解析出的上游键
 */
export function upstreamSnapshotForRef(ref: UpstreamModelRef | undefined): UpstreamModelSnapshot | undefined {
	if (ref === undefined) {
		return undefined;
	}
	const record = activeService?.record(ref.source, ref.upstreamModel);
	if (record === undefined || record.metadata === undefined) {
		return undefined;
	}
	return {
		source: ref.source,
		upstreamModel: ref.upstreamModel,
		fetchedAt: record.fetchedAt.toISOString(),
		metadata: record.metadata,
	};
}
