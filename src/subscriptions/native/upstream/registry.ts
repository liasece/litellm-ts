/**
 * 七家订阅上游的元信息适配器注册表。
 *
 * 每家上游的模型列表接口、鉴权与字段都不同，服务层只依赖这个统一契约：
 * - `supported`：是否存在可用的元信息接口（false 时只记一条 unsupported 负缓存）。
 * - `hasCredential`：账号是否具备调用凭据（缺凭据不发起网络请求）。
 * - `list` / `parse`：拉取原始条目、解析成归一化字段。
 *
 * 新增一家上游时只改这里与对应适配器文件，服务、合并、界面都不需要改。
 */

import { antigravityUpstreamAdapter } from "./antigravity";
import { claudeUpstreamAdapter } from "./claude";
import { codexUpstreamAdapter } from "./codex";
import { commandcodeUpstreamAdapter } from "./commandcode";
import { kimiUpstreamAdapter } from "./kimi";
import { opencodeUpstreamAdapter } from "./opencode";
import { xaiUpstreamAdapter } from "./xai";
import type { UpstreamSourceAdapter } from "./types";

/** 全部上游适配器；顺序与订阅 Provider 列表一致。 */
export const upstreamSourceAdapters: readonly UpstreamSourceAdapter[] = [
	codexUpstreamAdapter,
	claudeUpstreamAdapter,
	kimiUpstreamAdapter,
	antigravityUpstreamAdapter,
	xaiUpstreamAdapter,
	commandcodeUpstreamAdapter,
	opencodeUpstreamAdapter,
];
