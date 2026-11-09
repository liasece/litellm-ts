/**
 * 内置敏感信息识别规则。
 *
 * 设计目标与取舍：
 * - 只做**高精度**识别。所有命中都会被替换成占位符并进入模型上下文，误伤会让 agent
 *   正在处理的代码或标识符失真，因此宁可漏掉模糊值，也不把 UUID、commit hash、
 *   订单号、版本号一类结构性标识当作敏感信息。
 * - 每条规则都带 `prefilter`：先用 `String.includes` 做廉价预筛，只有可能命中时才跑正则。
 *   agent 的请求常有数百 KB 的工具输出，逐条正则扫描会带来可感知的延迟。
 * - 带校验位的类型（身份证、银行卡、IBAN、SSN）只在校验通过时才算命中，避免把
 *   随机数字串当成证件号。
 */

/** 识别规则定义 */
export interface PrivacyRule {
	/** 规则 ID（写入命中来源，便于诊断） */
	readonly id: string;
	/** 命中的敏感类型 */
	readonly kind:
		| "API_KEY"
		| "SECRET"
		| "JWT"
		| "PEM"
		| "PASSWORD"
		| "BEARER"
		| "EMAIL"
		| "PHONE"
		| "CN_ID"
		| "BANK_CARD"
		| "SSN"
		| "IBAN"
		| "USER";
	/** 匹配整段文本的正则（内部会自动补 `g` 与 `d` 标志） */
	readonly pattern: string;
	/** 额外正则标志（在 `g`/`d` 之外追加，例如 `i`） */
	readonly flags?: string;
	/** 需要脱敏的捕获组序号；缺省为整个匹配 */
	readonly group?: number;
	/** 廉价预筛：文本必须包含其中任意一个子串才会执行正则 */
	readonly prefilter: readonly string[];
	/** 命中值必须满足的额外校验（如校验位） */
	readonly validate?: (value: string) => boolean;
	/** 是否要求前文出现语境词 */
	readonly context?: RegExp;
	/** 命中值自身带方言前缀时免除语境要求（如 `+86`） */
	readonly selfPrefix?: RegExp;
	/** 命中前文命中该正则时放弃（例如邮箱规则放过 URL 里的 user:password） */
	readonly exclusion?: RegExp;
	/** 命中值的最小长度 */
	readonly minLength?: number;
}

/**
 * Luhn 校验（银行卡、部分会员号）。
 * @param digits - 只含数字的字符串
 */
export function passesLuhn(digits: string): boolean {
	let sum = 0;
	let double = false;
	for (let index = digits.length - 1; index >= 0; index--) {
		let value = digits.charCodeAt(index) - 48;
		if (value < 0 || value > 9) {
			return false;
		}
		if (double) {
			value *= 2;
			if (value > 9) {
				value -= 9;
			}
		}
		sum += value;
		double = !double;
	}
	return sum > 0 && sum % 10 === 0;
}

/**
 * 中国大陆身份证号校验（GB 11643 模 11-2）。
 * @param value - 18 位身份证号
 */
export function passesChinaIdChecksum(value: string): boolean {
	if (value.length !== 18) {
		return false;
	}
	const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const;
	const codes = "10X98765432";
	let sum = 0;
	for (let index = 0; index < 17; index++) {
		const digit = value.charCodeAt(index) - 48;
		if (digit < 0 || digit > 9) {
			return false;
		}
		sum += digit * weights[index]!;
	}
	return codes[sum % 11] === value[17]!.toUpperCase();
}

/**
 * IBAN 模 97 校验。
 * @param value - 可能带空格的 IBAN
 */
export function passesIbanChecksum(value: string): boolean {
	const compact = value.replace(/[\s]/g, "").toUpperCase();
	if (compact.length < 15 || compact.length > 34) {
		return false;
	}
	const rearranged = `${compact.slice(4)}${compact.slice(0, 4)}`;
	let remainder = 0;
	for (const character of rearranged) {
		const code = character.charCodeAt(0);
		const numeric = code >= 48 && code <= 57 ? character : String(code - 55);
		for (const digit of numeric) {
			remainder = (remainder * 10 + (digit.charCodeAt(0) - 48)) % 97;
		}
	}
	return remainder === 1;
}

/**
 * SSN 结构校验（排除 000/666/9xx 区号与全零段）。
 * @param value - 形如 `123-45-6789`
 */
export function passesSsnStructure(value: string): boolean {
	const parts = value.split("-");
	if (parts.length !== 3) {
		return false;
	}
	const [area, group, serial] = parts as [string, string, string];
	if (area === "000" || area === "666" || area.startsWith("9")) {
		return false;
	}
	return group !== "00" && serial !== "0000";
}

/** 邮箱中不应脱敏的示例域（文档、测试数据） */
export const EMAIL_ALLOWED_DOMAINS: ReadonlySet<string> = new Set([
	"example.com",
	"example.org",
	"example.net",
	"example.edu",
	"test.com",
	"test.local",
	"localhost",
	"invalid",
]);

/**
 * 判断邮箱域是否属于示例域。
 * @param email - 完整邮箱
 */
export function isAllowedEmail(email: string): boolean {
	const at = email.lastIndexOf("@");
	if (at < 0) {
		return false;
	}
	const domain = email.slice(at + 1).toLowerCase();
	if (EMAIL_ALLOWED_DOMAINS.has(domain)) {
		return true;
	}
	return domain.endsWith(".test") || domain.endsWith(".invalid") || domain.endsWith(".example") || domain.endsWith(".local");
}

/** 语境词：出现在手机号前 32 个字符内才认为它是电话号码，而不是订单号 */
export const PHONE_CONTEXT_PATTERN =
	/(?:手机|电话|联系方式|联系电话|手机号|联系人|短信|微信|whatsapp|phone|mobile|cell|tel|call|contact)/i;

/** 内置规则表；顺序即优先级，靠前的规则先占用匹配区间 */
export const PRIVACY_RULES: readonly PrivacyRule[] = [
	{
		id: "pem-private-key",
		kind: "PEM",
		pattern: "-----BEGIN (?:[A-Z0-9]+ )?PRIVATE KEY-----[\\s\\S]{16,4096}?-----END (?:[A-Z0-9]+ )?PRIVATE KEY-----",
		prefilter: ["-----BEGIN"],
	},
	{
		id: "jwt",
		kind: "JWT",
		pattern: "\\beyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\b",
		prefilter: ["eyJ"],
	},
	{
		id: "aws-access-key",
		kind: "API_KEY",
		pattern: "\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b",
		prefilter: ["AKIA", "ASIA"],
	},
	{
		id: "openai-style-key",
		kind: "API_KEY",
		pattern: "\\bsk-(?:ant-|proj-|admin-)?[A-Za-z0-9_-]{20,}\\b",
		prefilter: ["sk-"],
	},
	{
		id: "github-token",
		kind: "API_KEY",
		pattern: "\\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{20,255})\\b",
		prefilter: ["ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_"],
	},
	{
		id: "gitlab-token",
		kind: "API_KEY",
		pattern: "\\bglpat-[A-Za-z0-9_-]{20,255}\\b",
		prefilter: ["glpat-"],
	},
	{
		id: "google-api-key",
		kind: "API_KEY",
		pattern: "\\bAIza[0-9A-Za-z_-]{30,}\\b",
		prefilter: ["AIza"],
	},
	{
		id: "slack-token",
		kind: "API_KEY",
		pattern: "\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b",
		prefilter: ["xox"],
	},
	{
		id: "huggingface-token",
		kind: "API_KEY",
		pattern: "\\bhf_[A-Za-z0-9]{30,}\\b",
		prefilter: ["hf_"],
	},
	{
		id: "groq-key",
		kind: "API_KEY",
		pattern: "\\bgsk_[A-Za-z0-9]{40,}\\b",
		prefilter: ["gsk_"],
	},
	{
		id: "npm-token",
		kind: "API_KEY",
		pattern: "\\bnpm_[A-Za-z0-9]{30,}\\b",
		prefilter: ["npm_"],
	},
	{
		id: "pypi-token",
		kind: "API_KEY",
		pattern: "\\bpypi-[A-Za-z0-9_-]{40,}\\b",
		prefilter: ["pypi-"],
	},
	{
		id: "digitalocean-token",
		kind: "API_KEY",
		pattern: "\\bdop_v1_[a-f0-9]{60,}\\b",
		prefilter: ["dop_v1_"],
	},
	{
		id: "stripe-key",
		kind: "API_KEY",
		pattern: "\\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\\b",
		prefilter: ["sk_live_", "sk_test_", "rk_live_", "rk_test_"],
	},
	{
		id: "bearer-token",
		kind: "BEARER",
		pattern: "\\bBearer\\s+([A-Za-z0-9._~+/=-]{16,})",
		group: 1,
		prefilter: ["Bearer", "bearer"],
	},
	{
		id: "url-credentials",
		kind: "PASSWORD",
		pattern: "\\b[a-z][a-z0-9+.-]{1,12}:\\/\\/[^\\s/:@]{1,64}:([^\\s/@]{6,128})@",
		group: 1,
		prefilter: ["://"],
	},
	{
		id: "env-secret-assignment",
		kind: "SECRET",
		pattern:
			"\\b[A-Za-z0-9_]{0,48}(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CLIENT_?SECRET|CREDENTIAL|AUTH)[A-Za-z0-9_]{0,32}\\s*[=:]\\s*[\"']?([^\\s\"'\\\\,;]{8,512})",
		flags: "i",
		group: 1,
		prefilter: ["SECRET", "secret", "TOKEN", "token", "PASSWORD", "password", "PASSWD", "passwd", "KEY", "key", "AUTH", "auth"],
		// 赋值右侧是代码表达式（括号、点号引用链）时不是凭据字面量，例如函数调用前缀或环境变量引用。
		validate: (value) =>
			!/[(){}[\]]/.test(value) &&
			!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value) &&
			!/^(?:Bearer|Basic|Token|bearer|basic|token)$/.test(value),
	},
	{
		id: "email",
		kind: "EMAIL",
		pattern: "\\b[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)+[A-Za-z]{2,24}\\b",
		prefilter: ["@"],
		validate: (value) => !isAllowedEmail(value),
		exclusion: /[a-z][a-z0-9+.-]{1,12}:\/\/[^\s/:@]{1,64}:$/i,
	},
	{
		id: "china-mobile",
		kind: "PHONE",
		pattern: "(?<![0-9])(?:\\+?86[- ]?)?(1[3-9][0-9]{9})(?![0-9])",
		group: 1,
		prefilter: ["1"],
		context: PHONE_CONTEXT_PATTERN,
		selfPrefix: /^\+86/,
	},
	{
		id: "china-id-card",
		kind: "CN_ID",
		pattern: "(?<![0-9A-Za-z])([1-9][0-9]{5}(?:19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])[0-9]{3}[0-9Xx])(?![0-9A-Za-z])",
		group: 1,
		prefilter: ["19", "20"],
		validate: passesChinaIdChecksum,
	},
	{
		id: "bank-card",
		kind: "BANK_CARD",
		pattern:
			"(?<![0-9])((?:4[0-9]{12}(?:[0-9]{3})?)|(?:5[1-5][0-9]{14})|(?:6(?:011|5[0-9]{2})[0-9]{12})|(?:3[47][0-9]{13})|(?:62[0-9]{14,17}))(?![0-9])",
		group: 1,
		prefilter: ["4", "5", "6", "3"],
		validate: passesLuhn,
	},
	{
		id: "us-ssn",
		kind: "SSN",
		pattern: "(?<![0-9])([0-9]{3}-[0-9]{2}-[0-9]{4})(?![0-9])",
		group: 1,
		prefilter: ["-"],
		validate: passesSsnStructure,
	},
	{
		id: "iban",
		kind: "IBAN",
		pattern: "(?<![A-Za-z0-9])([A-Z]{2}[0-9]{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?)(?![A-Za-z0-9])",
		group: 1,
		prefilter: ["GB", "DE", "FR", "NL", "ES", "IT", "CH", "AT", "BE", "SE", "NO", "DK", "FI", "PL", "IE", "PT"],
		validate: passesIbanChecksum,
	},
	{
		id: "home-directory-user",
		kind: "USER",
		pattern: "(?:\\/Users\\/|\\/home\\/)([A-Za-z0-9._-]{2,32})(?:\\/|\\b)",
		group: 1,
		prefilter: ["/Users/", "/home/"],
	},
];

/**
 * 编译带 `g`/`d` 标志的正则；每次扫描使用独立实例，避免共享 `lastIndex`。
 * @param rule - 规则定义
 */
export function compileRulePattern(rule: PrivacyRule): RegExp {
	return new RegExp(rule.pattern, `gd${rule.flags ?? ""}`);
}
