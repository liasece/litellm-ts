/**
 * UserApiKeyAuth 认证中间件测试
 */
import type { Request } from "express";
import { extractApiKey } from "./UserApiKeyAuth";
import { hashApiKey } from "../core/utils/crypto";

function mkReq(headers: Record<string, string>): Request {
	return { headers: headers } as Request;
}

describe("UserApiKeyAuth", () => {
	describe("extractApiKey", () => {
		it("extracts from Bearer token", () => {
			const req = mkReq({ authorization: "Bearer sk-test-key-123" });
			expect(extractApiKey(req)).toBe("sk-test-key-123");
		});

		it("extracts from x-api-key header", () => {
			const req = mkReq({ "x-api-key": "sk-my-key" });
			expect(extractApiKey(req)).toBe("sk-my-key");
		});

		it("extracts from x-litellm-key header", () => {
			const req = mkReq({ "x-litellm-key": "sk-litellm-key" });
			expect(extractApiKey(req)).toBe("sk-litellm-key");
		});

		it("prefers Authorization Bearer over x-api-key", () => {
			const req = mkReq({ authorization: "Bearer sk-bearer", "x-api-key": "sk-header" });
			expect(extractApiKey(req)).toBe("sk-bearer");
		});

		it("returns null when no key present", () => {
			const req = mkReq({});
			expect(extractApiKey(req)).toBeNull();
		});

		it("ignores empty x-api-key", () => {
			const req = mkReq({ "x-api-key": "" });
			expect(extractApiKey(req)).toBeNull();
		});
	});

	describe("hashApiKey", () => {
		it("produces consistent SHA-256 hash", () => {
			const h1 = hashApiKey("test-key");
			const h2 = hashApiKey("test-key");
			expect(h1).toBe(h2);
			expect(h1).toHaveLength(64);
		});

		it("produces different hashes for different keys", () => {
			expect(hashApiKey("key-a")).not.toBe(hashApiKey("key-b"));
		});
	});
});
