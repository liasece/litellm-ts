import { ApiError } from "../core/api/ApiError";

/**
 * 订阅账号的展示身份。
 *
 * 账号邮箱通常由上游登录流程写进 auth 文件；Key 型 Provider 只按密钥识别订阅，
 * 上游不返回任何身份，管理员可以手工登记一个邮箱，账号表与额度卡片据此显示可核对的账号。
 * 这里只做形状校验，不猜测归属，也不会把邮箱发送给上游。
 */

/** 邮箱长度上限取自 RFC 5321；实际账号邮箱远小于该值。 */
const MAX_ACCOUNT_EMAIL_LENGTH = 320;

/**
 * 归一化手工登记的账号邮箱。
 * @param value - 已解析的请求字段
 * @returns 去空白后的邮箱；空值返回 null（表示清除）
 * @throws {ApiError} 字段不是字符串或邮箱形状非法时抛出
 */
export function normalizeAccountEmail(value: unknown): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "string") {
		throw ApiError.badRequest("账号邮箱必须是字符串");
	}
	const email = value.trim();
	if (!email) {
		return null;
	}
	if (email.length > MAX_ACCOUNT_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		throw ApiError.badRequest("请填写有效的账号邮箱");
	}
	return email;
}

/** 账号表里可用于展示身份的窄字段；不允许把整份 payload 或密钥读进 Usage。 */
export interface SubscriptionAccountDisplayIdentity {
	/** 上游登录流程写入的邮箱。 */
	readonly email?: string | null;
	/** 订阅来源，例如 commandcode；显示时作为账号前缀。 */
	readonly provider?: string | null;
	/** 手工登记的展示名；Key 型 Provider 通常在这里写邮箱。 */
	readonly label?: string | null;
	/** 旧 auth 文件名；只在没有邮箱和展示名时兜底。 */
	readonly accountKey?: string | null;
	/** 稳定账号 ID，用于最后的可辨识兜底。 */
	readonly id: string;
}

/**
 * 订阅账号在 Usage 等读侧显示的身份。
 *
 * 上游邮箱最可靠，其次是管理员登记的 label（CommandCode 等只有 API key 的 Provider
 * 没有 email 字段，邮箱通常写在 label 里），最后才退回 auth 文件名。文件名是内部
 * 迁移键，不能盖过真实账号身份。最终统一带上 Provider 前缀，便于在混合账号列表里
 * 直接分辨来源，例如 `commandcode/owner@example.com`。
 * @param identity - 账号表中已取出的窄字段
 */
export function subscriptionAccountDisplayName(identity: SubscriptionAccountDisplayIdentity): string {
	const email = identity.email?.trim();
	const label = email ? null : identity.label?.trim();
	const accountKey = email || label ? null : identity.accountKey?.trim();
	const name = email ?? label ?? accountKey ?? `Subscription ${identity.id.slice(0, 8)}`;
	const provider = identity.provider?.trim();
	return provider && !name.startsWith(`${provider}/`) ? `${provider}/${name}` : name;
}
