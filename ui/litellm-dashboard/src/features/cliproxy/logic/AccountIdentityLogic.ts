import type { Account } from "../support/CliProxyModels";

/**
 * 管理面展示的账号身份。
 *
 * OAuth 账号使用邮箱；CommandCode 等 Key 型账号的邮箱由额度接口的 whoami
 * 返回，账号文件尚未回写时先用 `quotaEmail`。没有邮箱时才回退到管理员保存的
 * 标签；两者都缺失时返回 null，由调用方决定回退到文件名或占位符。
 */
export function accountIdentity(account: Pick<Account, "email" | "label">, quotaEmail?: string | null): string | null {
	return account.email?.trim() || quotaEmail?.trim() || account.label?.trim() || null;
}
