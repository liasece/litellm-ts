import { describe, expect, it } from "vitest";
import type { LogEntry } from "../support/LogsModels";
import { privacyReplacementView } from "./LogDetailsPrivacyLogic";

function log(overrides: Partial<LogEntry> = {}): LogEntry {
	return {
		request_id: "request-1",
		startTime: "2026-11-15T02:00:00Z",
		metadata: {
			applied_features: [{ id: "privacy", count: 2, detail: "EMAIL×2" }],
		},
		messages: [{ role: "user", content: "contact {{EMAIL_abcd2345}} please" }],
		proxy_server_request: {
			upstream_request: {
				body: {
					input: [{ role: "user", content: [{ type: "input_text", text: "contact {{EMAIL_abcd2345}} and {{EMAIL_efgh2345}}" }] }],
				},
			},
		},
		...overrides,
	};
}

describe("log detail privacy replacements", () => {
	it("归并占位符并保留位置、次数和脱敏上下文", () => {
		const view = privacyReplacementView(log());
		expect(view.visible).toBe(true);
		// 与列表徽标同口径：账本记了 2 处替换，正文里多出来的是模型复述，不计入替换处数。
		expect(view.occurrences).toBe(2);
		expect(view.distinctValues).toBe(2);
		expect(view.summary).toBe("邮箱 ×2");
		expect(view.replacements).toHaveLength(2);
		expect(view.replacements[0]).toMatchObject({
			token: "{{EMAIL_abcd2345}}",
			kind: "EMAIL",
			kindLabel: "邮箱",
			occurrences: 2,
			locations: ["Request", "Upstream request"],
			field: "[0].content",
		});
		expect(view.replacements[0].context).toContain("{{EMAIL_abcd2345}}");
	});

	it("账本省略 count 时按 1 处替换展示，与列表徽标一致", () => {
		const view = privacyReplacementView(
			log({
				metadata: { applied_features: [{ id: "privacy", detail: "EMAIL×1" }] },
				messages: null,
				proxy_server_request: null,
			}),
		);
		expect(view.visible).toBe(true);
		expect(view.occurrences).toBe(1);
		expect(view.summary).toBe("邮箱 ×1");
		expect(view.replacements).toEqual([]);
	});

	it("正文不可用时仍根据 capabilities 账本显示替换摘要", () => {
		const view = privacyReplacementView(log({ messages: null, proxy_server_request: null }));
		expect(view.visible).toBe(true);
		expect(view.occurrences).toBe(2);
		expect(view.distinctValues).toBe(0);
		expect(view.featureDetail).toBe("EMAIL×2");
		expect(view.replacements).toEqual([]);
	});

	it("没有 Privacy 记录或占位符时不显示板块", () => {
		const view = privacyReplacementView(
			log({ metadata: {}, messages: [{ role: "user", content: "hello" }], proxy_server_request: null }),
		);
		expect(view.visible).toBe(false);
	});
});
