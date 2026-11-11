import { describe, expect, it } from "vitest";
import {
	TIMELINE_EARLIER_TRIGGER_DISTANCE,
	TIMELINE_NEWEST_END_TOLERANCE,
	keepsTimelineScrollAnchor,
	reachesTimelineEarlierEnd,
	reachesTimelineNewerEnd,
	timelineAnchorShift,
	type TimelineScrollMetrics,
} from "./SessionTimelineScrollLogic";

const viewport = (overrides: Partial<TimelineScrollMetrics> = {}): TimelineScrollMetrics => ({
	newestFirst: true,
	scrollTop: 0,
	clientHeight: 600,
	scrollHeight: 3000,
	...overrides,
});

describe("session timeline earlier page trigger", () => {
	it("只在新排列下贴近列表末尾时取更早的一页", () => {
		expect(reachesTimelineEarlierEnd(viewport({ scrollTop: 2000 }))).toBe(false);
		expect(reachesTimelineEarlierEnd(viewport({ scrollTop: 2400 - TIMELINE_EARLIER_TRIGGER_DISTANCE }))).toBe(true);
		expect(reachesTimelineEarlierEnd(viewport({ scrollTop: 2400 }))).toBe(true);
	});

	it("最早优先排列下改由列表开头触发", () => {
		expect(reachesTimelineEarlierEnd(viewport({ newestFirst: false, scrollTop: 600 }))).toBe(false);
		expect(reachesTimelineEarlierEnd(viewport({ newestFirst: false, scrollTop: TIMELINE_EARLIER_TRIGGER_DISTANCE }))).toBe(true);
		expect(reachesTimelineEarlierEnd(viewport({ newestFirst: false, scrollTop: 0 }))).toBe(true);
	});

	it("内容撑不满面板时不自动取页，避免一次拉完整段历史", () => {
		expect(reachesTimelineEarlierEnd(viewport({ clientHeight: 3000 }))).toBe(false);
		expect(reachesTimelineEarlierEnd(viewport({ clientHeight: 0, scrollHeight: 0 }))).toBe(false);
	});
});

describe("session timeline newer page trigger", () => {
	it("最早优先时贴近列表末尾取更新的一页", () => {
		expect(reachesTimelineNewerEnd(viewport({ newestFirst: false, scrollTop: 2000 }))).toBe(false);
		expect(reachesTimelineNewerEnd(viewport({ newestFirst: false, scrollTop: 2400 - TIMELINE_EARLIER_TRIGGER_DISTANCE }))).toBe(true);
		expect(reachesTimelineNewerEnd(viewport({ newestFirst: false, scrollTop: 2400 }))).toBe(true);
	});

	it("内容撑不满面板时不自动取页，交给「加载更多」按钮", () => {
		expect(reachesTimelineNewerEnd(viewport({ newestFirst: false, clientHeight: 3000 }))).toBe(false);
		expect(reachesTimelineNewerEnd(viewport({ newestFirst: false, clientHeight: 0, scrollHeight: 0 }))).toBe(false);
	});
});

describe("session timeline scroll anchor", () => {
	it("最新优先时只有停在顶端才让新事件顶开视野", () => {
		expect(keepsTimelineScrollAnchor(viewport({ scrollTop: 0 }))).toBe(false);
		expect(keepsTimelineScrollAnchor(viewport({ scrollTop: TIMELINE_NEWEST_END_TOLERANCE }))).toBe(false);
		expect(keepsTimelineScrollAnchor(viewport({ scrollTop: TIMELINE_NEWEST_END_TOLERANCE + 1 }))).toBe(true);
		expect(keepsTimelineScrollAnchor(viewport({ scrollTop: 900 }))).toBe(true);
	});

	it("最早优先时始终保持阅读位置：新事件追加在末尾，视野上方只会插入更早的页", () => {
		expect(keepsTimelineScrollAnchor(viewport({ newestFirst: false, scrollTop: 0 }))).toBe(true);
		expect(keepsTimelineScrollAnchor(viewport({ newestFirst: false, scrollTop: 2400 }))).toBe(true);
	});

	it("非有限值按不补回处理，避免把滚动位置写成 NaN", () => {
		expect(keepsTimelineScrollAnchor(viewport({ scrollTop: Number.NaN }))).toBe(true);
	});

	it("漂移量就是锚点两次相对位置的差，内容没动时为 0", () => {
		expect(timelineAnchorShift(-40, 320)).toBe(360);
		expect(timelineAnchorShift(120, 120)).toBe(0);
		expect(timelineAnchorShift(120, Number.NaN)).toBe(0);
	});
});
