/**
 * 会话亲和键与头值工具测试。
 */

import { resolveSessionKey, sessionKeyValue, stableDeviceId } from "./session";

it("WebSocket 的 session_id 头参与会话亲和", () => {
	expect(resolveSessionKey({ session_id: "ws-session-1" }, {})).toBe("session_id:ws-session-1");
	expect(resolveSessionKey({ "Session-Id": "http-session-1" }, {})).toBe("session-id:http-session-1");
});

it("剥掉桥接层加上的已知字段前缀", () => {
	expect(sessionKeyValue("x-opencode-session:sess-1")).toBe("sess-1");
	expect(sessionKeyValue("content:abc123")).toBe("abc123");
	expect(sessionKeyValue("metadata.user_id:user-1")).toBe("user-1");
	expect(sessionKeyValue("conversation_id:conv-1")).toBe("conv-1");
	// 客户端自带的未知前缀不是桥接层协议，必须原样保留。
	expect(sessionKeyValue("client:value")).toBe("client:value");
});

it("设备 ID 派生稳定且不包含账号明文", () => {
	const first = stableDeviceId("kimi-device\u0000account-1");
	const second = stableDeviceId("kimi-device\u0000account-1");
	expect(first).toBe(second);
	expect(first).toMatch(/^[0-9a-f]{64}$/);
	expect(first).not.toContain("account-1");
});
