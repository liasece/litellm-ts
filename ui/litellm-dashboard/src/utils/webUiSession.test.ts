import { buildWebSocketCredentialProtocols, WEB_UI_COOKIE_SESSION_SENTINEL } from "./webUiSession";

describe("buildWebSocketCredentialProtocols", () => {
	it("交出真实密钥子协议，供无 Cookie 的客户端在握手里鉴权", () => {
		expect(buildWebSocketCredentialProtocols("sk-1234")).toEqual(["litellm_sk-1234"]);
	});

	it("cookie 会话下不提交占位标记：服务端会优先采用子协议里的密钥而判为无效", () => {
		expect(buildWebSocketCredentialProtocols(WEB_UI_COOKIE_SESSION_SENTINEL)).toEqual([]);
	});

	it("未登录时没有凭据可提交", () => {
		expect(buildWebSocketCredentialProtocols("")).toEqual([]);
		expect(buildWebSocketCredentialProtocols(null)).toEqual([]);
		expect(buildWebSocketCredentialProtocols(undefined)).toEqual([]);
	});
});
