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
