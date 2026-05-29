/**
 * BudgetAlerts — 预算报警通道
 *
 * 对齐 PY `litellm/integrations/SlackAlerting.py` + `budget_alerts` 体系。
 * 提供软预算（soft_budget）、硬预算（max_budget）的多通道报警：
 * - Email (SMTP)
 * - Slack (incoming webhook)
 * - 通用 Webhook (HTTP POST)
 *
 * TS 之前仅 `logger.warn`；现在 soft_budget 超限会触发已注册的所有 channels。
 * channels 通过 `registerAlertChannel` 注入；测试场景使用 `clearAlertChannels`。
 */

import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("BudgetAlerts");

/** 报警事件类型枚举（与 BudgetAlertEvent.type 字段一一对应） */
export enum BudgetAlertType {
	/** 软预算已超出：累计 spend > soft_budget，仅警告不阻断，对齐 PY soft_budget_alert */
	SoftBudgetExceeded = "soft_budget_exceeded",
	/** 硬预算已超出：累计 spend > max_budget，触发后应阻断后续请求，对齐 PY max_budget_alert */
	HardBudgetExceeded = "hard_budget_exceeded",
	/** 软预算预警：spend 达到 soft_budget 的指定百分比阈值（thresholdPct），提前通知 */
	SoftBudgetWarning = "soft_budget_warning",
}

/** 报警事件类型 */
export type BudgetAlertEvent =
	| { type: BudgetAlertType.SoftBudgetExceeded; entity: BudgetEntity; spend: number; softBudget: number; keyName?: string }
	| { type: BudgetAlertType.HardBudgetExceeded; entity: BudgetEntity; spend: number; maxBudget: number; keyName?: string }
	| {
			type: BudgetAlertType.SoftBudgetWarning;
			entity: BudgetEntity;
			spend: number;
			softBudget: number;
			thresholdPct: number;
			keyName?: string;
	  };

/**
 * 预算适用的实体类型
 *
 * 每个枚举值对应一种可独立计费/受限的主体：
 * - Key: 单个 API Key（最细粒度）
 * - User: 平台用户（跨多个 key 汇总）
 * - Team: 团队/小组
 * - Organization: 组织（跨多个 team 汇总）
 * - EndUser: 终端调用方标识（如 SaaS 客户端的最终用户）
 */
export enum BudgetEntity {
	Key = "key",
	User = "user",
	Team = "team",
	Organization = "organization",
	EndUser = "end_user",
}

/** 报警 channel 接口 */
export interface AlertChannel {
	/** channel 名称（如 "slack", "email", "webhook"） */
	readonly name: string;
	/** 推送报警事件（异步，best-effort，不应抛出） */
	send(event: BudgetAlertEvent): Promise<void> | void;
}

/** 注册的 channels（进程级单例） */
const _channels: AlertChannel[] = [];

/**
 * 注册一个报警 channel
 * @param channel
 */
export function registerAlertChannel(channel: AlertChannel): void {
	_channels.push(channel);
	logger.debug(`已注册报警 channel: ${channel.name}`);
}

/**
 * 清空所有 channels（仅用于测试或重新配置）
 */
export function clearAlertChannels(): void {
	_channels.length = 0;
}

/**
 * 触发一个报警事件，分发到所有 channels
 * @param event
 */
export async function emitBudgetAlert(event: BudgetAlertEvent): Promise<void> {
	if (_channels.length === 0) {
		// 兜底日志，避免静默丢事件（与原 logger.warn 行为对齐）
		logger.warn(`[budget_alert] ${JSON.stringify(event)}`);
		return;
	}
	await Promise.allSettled(
		_channels.map(async (ch) => {
			try {
				await Promise.resolve(ch.send(event));
			} catch (err) {
				logger.warn(`channel "${ch.name}" 报警发送失败: ${(err as Error).message}`);
			}
		}),
	);
}

// ========== 内置 channel 实现 ==========
/**
 * Slack incoming webhook channel。
 * 把 BudgetAlertEvent 作为简单 text 推送到 Slack。
 */
export class SlackAlertChannel implements AlertChannel {
	readonly name = "slack";
	private _webhookUrl: string;

	constructor(webhookUrl: string) {
		this._webhookUrl = webhookUrl;
	}

	/**
	 * @param event
	 */
	async send(event: BudgetAlertEvent): Promise<void> {
		const text = this._formatEvent(event);
		await fetch(this._webhookUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ text: text }),
		});
	}

	private _formatEvent(event: BudgetAlertEvent): string {
		return formatBudgetAlertText(event);
	}
}

/**
 * 通用 webhook channel。
 * POST 完整 BudgetAlertEvent JSON 到配置的 URL。
 */
export class WebhookAlertChannel implements AlertChannel {
	readonly name = "webhook";
	private _url: string;
	private _headers: Record<string, string>;

	constructor(url: string, headers: Record<string, string> = {}) {
		this._url = url;
		this._headers = headers;
	}

	/**
	 * @param event
	 */
	async send(event: BudgetAlertEvent): Promise<void> {
		await fetch(this._url, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...this._headers },
			body: JSON.stringify(event),
		});
	}
}

/**
 * Email channel（SMTP 通过 nodemailer-like 接口）。
 * 接受一个 `sendMail(opts)` 函数作为运行时依赖，避免在本仓库硬绑 SMTP 客户端。
 */
export interface EmailSender {
	/**
	 *
	 */
	sendMail(opts: { to: string; subject: string; text: string }): Promise<void>;
}

/**
 *
 */
export class EmailAlertChannel implements AlertChannel {
	readonly name = "email";
	private _sender: EmailSender;
	private _recipients: string[];

	constructor(sender: EmailSender, recipients: string[]) {
		this._sender = sender;
		this._recipients = recipients;
	}

	/**
	 * @param event
	 */
	async send(event: BudgetAlertEvent): Promise<void> {
		const subject = formatBudgetAlertSubject(event);
		const text = JSON.stringify(event, null, 2);
		for (const to of this._recipients) {
			await this._sender.sendMail({ to: to, subject: subject, text: text });
		}
	}
}

// ========== 共享格式化 helper（消除 Slack/Email 重复 switch） ==========

/**
 * 共享：把 BudgetAlertEvent 格式化为 Slack/Text 友好的单行文本。
 * @param event
 */
export function formatBudgetAlertText(event: BudgetAlertEvent): string {
	const key = event.keyName ?? "unknown";
	switch (event.type) {
		case BudgetAlertType.SoftBudgetExceeded:
			return `:warning: Soft Budget Exceeded — entity=${event.entity} key=${key} spend=${event.spend} soft_budget=${event.softBudget}`;
		case BudgetAlertType.HardBudgetExceeded:
			return `:rotating_light: Hard Budget Exceeded — entity=${event.entity} key=${key} spend=${event.spend} max_budget=${event.maxBudget}`;
		case BudgetAlertType.SoftBudgetWarning:
			return `:bell: Soft Budget Warning (${event.thresholdPct}%) — entity=${event.entity} key=${key} spend=${event.spend} soft_budget=${event.softBudget}`;
		default:
			return `[budget_alert] ${JSON.stringify(event)}`;
	}
}

/**
 * 共享：把 BudgetAlertEvent 格式化为邮件主题。
 * @param event
 */
export function formatBudgetAlertSubject(event: BudgetAlertEvent): string {
	switch (event.type) {
		case BudgetAlertType.SoftBudgetExceeded:
			return `[LiteLLM] Soft Budget Exceeded for ${event.entity}`;
		case BudgetAlertType.HardBudgetExceeded:
			return `[LiteLLM] Hard Budget Exceeded for ${event.entity}`;
		case BudgetAlertType.SoftBudgetWarning:
			return `[LiteLLM] Soft Budget Warning (${event.thresholdPct}%) for ${event.entity}`;
		default:
			return `[LiteLLM] Budget alert`;
	}
}
