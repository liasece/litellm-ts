import { markFirstContentFrame } from "./FirstContentFrame";

describe("markFirstContentFrame", () => {
	function fakeRequest() {
		const markCompletionStart = jest.fn();
		return {
			req: { activeRequestJournal: { markCompletionStart: markCompletionStart } },
			markCompletionStart: markCompletionStart,
		};
	}

	it("首次调用即补写在途行，后续调用复用同一时刻且不重复补写", () => {
		const { req, markCompletionStart } = fakeRequest();
		const first = markFirstContentFrame(req as never, new Date("2026-11-09T00:00:01.000Z"));
		const second = markFirstContentFrame(req as never, new Date("2026-11-09T00:00:09.000Z"));

		expect(first.toISOString()).toBe("2026-11-09T00:00:01.000Z");
		expect(second).toBe(first);
		expect(markCompletionStart).toHaveBeenCalledTimes(1);
		expect(markCompletionStart).toHaveBeenCalledWith(first);
	});

	it("没有在途补写器时仍返回时间，不影响请求路径", () => {
		const req = {};
		expect(markFirstContentFrame(req as never, new Date("2026-11-09T00:00:02.000Z")).toISOString()).toBe(
			"2026-11-09T00:00:02.000Z",
		);
	});
});
