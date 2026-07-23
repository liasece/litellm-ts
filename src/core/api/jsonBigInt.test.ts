import { jsonBigIntReplacer } from "./jsonBigInt";

describe("JSON BIGINT boundary", () => {
	it("超过 Number 安全范围时以十进制字符串保留精度", () => {
		expect(JSON.stringify({ count: 9_007_199_254_740_993n }, jsonBigIntReplacer)).toBe('{"count":"9007199254740993"}');
	});
});
