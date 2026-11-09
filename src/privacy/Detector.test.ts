/**
 * 识别规则契约：常见密钥 / 个人信息要命中，结构性标识与示例数据不能误伤。
 */
import { scanText, type ScanOptions } from "./Detector";
import { passesChinaIdChecksum, passesIbanChecksum, passesLuhn } from "./DetectionRules";

const OPTIONS: ScanOptions = {
	disabledKinds: new Set<string>(),
	customWords: [],
	configuredSecrets: [],
	allowlist: [],
};

/**
 * 扫描出命中值。
 * @param text - 文本
 * @param options - 覆盖选项
 */
function values(text: string, options: Partial<ScanOptions> = {}): string[] {
	return scanText(text, { ...OPTIONS, ...options }).map((hit) => hit.value);
}

describe("sensitive detection", () => {
	it("识别常见供应商密钥", () => {
		expect(values("OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz012345")).toContain("sk-proj-abcdefghijklmnopqrstuvwxyz012345");
		expect(values("key AKIAIOSFODNN7EXAMPLE used")).toContain("AKIAIOSFODNN7EXAMPLE");
		expect(values("Authorization: Bearer abcdefghijklmnopqrstuvwxyz")).toContain("abcdefghijklmnopqrstuvwxyz");
		expect(values("token ghp_abcdefghijklmnopqrstuvwxyz0123456789")).toContain("ghp_abcdefghijklmnopqrstuvwxyz0123456789");
	});

	it("识别 PEM 私钥整段（含换行）", () => {
		const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
		expect(values(`before\n${pem}\nafter`)).toContain(pem);
	});

	it("识别 JWT", () => {
		const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop";
		expect(values(`token=${jwt}`)).toContain(jwt);
	});

	it("识别邮箱，但放过示例域", () => {
		expect(values("联系人 jansen@liasece.com")).toContain("jansen@liasece.com");
		expect(values("示例 user@example.com 与 dev@localhost")).toEqual([]);
	});

	it("手机号需要语境或 +86 前缀", () => {
		expect(values("手机号 13800138000")).toContain("13800138000");
		expect(values("订单 13800138000 已发货")).toEqual([]);
		expect(values("call +8613800138000")).toContain("13800138000");
	});

	it("身份证与银行卡需要校验位", () => {
		const validId = "11010519491231002X";
		expect(passesChinaIdChecksum(validId)).toBe(true);
		expect(values(`身份证 ${validId}`)).toContain(validId);
		expect(values("编号 110105194912310021")).toEqual([]);

		const validCard = "4111111111111111";
		expect(passesLuhn(validCard)).toBe(true);
		expect(values(`卡号 ${validCard}`)).toContain(validCard);
		expect(values("单号 4111111111111112")).toEqual([]);
	});

	it("IBAN 需要模 97 校验", () => {
		const iban = "GB82WEST12345698765432";
		expect(passesIbanChecksum(iban)).toBe(true);
		expect(values(`IBAN ${iban}`)).toContain(iban);
		expect(values("代码 GB82WEST12345698765433")).toEqual([]);
	});

	it("SSN 结构校验", () => {
		expect(values("ssn 123-45-6789")).toContain("123-45-6789");
		expect(values("ssn 000-45-6789")).toEqual([]);
		expect(values("ssn 666-45-6789")).toEqual([]);
	});

	it("URL 内嵌密码", () => {
		expect(values("postgres://admin:s3cretPassw0rd@db.internal:5432/app")).toContain("s3cretPassw0rd");
	});

	it("环境变量式赋值", () => {
		expect(values('DB_PASSWORD="hunter2hunter2"')).toContain("hunter2hunter2");
		expect(values("client_secret: abcdef123456")).toContain("abcdef123456");
	});

	it("家目录用户名", () => {
		expect(values("打开 /Users/jansen/project/file.ts")).toContain("jansen");
		expect(values("运行 /home/deploy/app.sh")).toContain("deploy");
	});

	it("不误伤 UUID、commit hash、版本号与订单号", () => {
		const text = [
			"id 550e8400-e29b-41d4-a716-446655440000",
			"commit 9f2c1a7b3e5d8c0a1b2c3d4e5f60718293a4b5c6",
			"version 1.2.3-beta.4",
			"order 202411091234567890",
		].join("\n");
		expect(values(text)).toEqual([]);
	});

	it("已存在的占位符不会被再次命中", () => {
		const options: Partial<ScanOptions> = { customWords: [{ value: "{{EMAIL_abcdefgh}}" }] };
		expect(values("mail {{EMAIL_abcdefgh}}", options)).toEqual([]);
	});

	it("自定义词条与配置凭据按字面量命中", () => {
		expect(values("项目代号 蓝鲸计划", { customWords: [{ value: "蓝鲸计划" }] })).toContain("蓝鲸计划");
		expect(values("leaked supersecretvalue123", { configuredSecrets: ["supersecretvalue123"] })).toContain("supersecretvalue123");
	});

	it("白名单值不脱敏", () => {
		expect(values("mail jansen@liasece.com", { allowlist: ["jansen@liasece.com"] })).toEqual([]);
	});

	it("赋值右侧是代码调用时不当作凭据", () => {
		const call = ["page", "locator"].join(".") + '("body")';
		const code = "const tokens = " + call + ";\nconst password = getEnv" + '("PASSWORD");';
		const ref = "const clientSecret = " + ["process", "env", "CLIENT_SECRET"].join(".") + ";";
		const hits = scanText(code + "\n" + ref, OPTIONS);
		expect(hits.filter((hit) => hit.kind === "SECRET")).toHaveLength(0);
	});

	it("赋值右侧是字面量凭据时仍然脱敏", () => {
		const literal = ["abcd", "1234", "efgh", "5678"].join("");
		const hits = scanText('const token = "' + literal + '";', OPTIONS);
		expect(hits.map((hit) => hit.kind)).toContain("SECRET");
		expect(hits.map((hit) => hit.value)).toContain(literal);
	});
});
