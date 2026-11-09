/** 占位符切分：展示层必须按原顺序、零丢失地切出片段。 */
import { describe, expect, it } from "vitest";
import { containsPrivacyPlaceholder, privacyKindLabel, privacyPlaceholderTitle, splitPrivacyPlaceholders } from "./PrivacyPlaceholderLogic";

describe("privacy placeholder text", () => {
	it("没有占位符时原样返回单片段", () => {
		expect(splitPrivacyPlaceholders("plain text")).toEqual([{ text: "plain text" }]);
	});

	it("切出占位符并保留前后文本", () => {
		const segments = splitPrivacyPlaceholders("key {{API_KEY_abcd2fgh}} done");
		expect(segments).toEqual([{ text: "key " }, { text: "{{API_KEY_abcd2fgh}}", kind: "API_KEY" }, { text: " done" }]);
	});

	it("连续占位符与句首占位符都不丢字符", () => {
		const segments = splitPrivacyPlaceholders("{{EMAIL_abcd2fgh}}{{PHONE_cdef2ghj}}");
		expect(segments).toHaveLength(2);
		expect(segments.map((segment) => segment.kind)).toEqual(["EMAIL", "PHONE"]);
	});

	it("格式不符的花括号保持原文", () => {
		expect(splitPrivacyPlaceholders("{{EMAIL_UPPER123}}")).toEqual([{ text: "{{EMAIL_UPPER123}}" }]);
		expect(splitPrivacyPlaceholders("{{EMAIL_abcd2fg}}")).toEqual([{ text: "{{EMAIL_abcd2fg}}" }]);
	});

	it("布尔判断与中文名、提示文案", () => {
		expect(containsPrivacyPlaceholder("x {{EMAIL_abcd2fgh}}")).toBe(true);
		expect(containsPrivacyPlaceholder("x {{EMAIL_abcd2fgh}}".toUpperCase())).toBe(false);
		expect(containsPrivacyPlaceholder("plain")).toBe(false);
		expect(privacyKindLabel("CN_ID")).toBe("身份证号");
		expect(privacyKindLabel("ROLE")).toBe("ROLE");
		expect(privacyPlaceholderTitle("EMAIL")).toContain("邮箱");
		expect(privacyPlaceholderTitle("EMAIL")).toContain("不是原文");
	});
});
