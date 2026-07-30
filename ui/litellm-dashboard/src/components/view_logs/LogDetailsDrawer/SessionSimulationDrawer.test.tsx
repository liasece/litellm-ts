import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionTimelineEvent } from "../../networking";
import {
	formatSessionKey,
	orderSessionTimeline,
	parseIdeOpenedFilePrefixes,
	parseTranscriptEntries,
	parseUserContextPrefixes,
	SystemReminderView,
	TranscriptView,
} from "./SessionSimulationDrawer";

function makeEvent(overrides: Partial<SessionTimelineEvent>): SessionTimelineEvent {
	return {
		id: "req-1:request:0",
		request_id: "req-1",
		role: "user",
		label: "用户输入",
		timestamp: "2026-07-24T10:00:00.000Z",
		model: "claude",
		content: "第一问",
		...overrides,
	};
}

describe("orderSessionTimeline", () => {
	it("支持按真实事件时间最新优先展示，且不修改服务端返回数组", () => {
		const timeline = [
			makeEvent({ id: "req-1:user", content: "第一问" }),
			makeEvent({
				id: "req-1:assistant",
				role: "assistant",
				label: "输出",
				timestamp: "2026-07-24T10:00:10.000Z",
				content: "第一答",
			}),
			makeEvent({
				id: "req-2:user",
				request_id: "req-2",
				timestamp: "2026-07-24T10:00:02.000Z",
				content: "第二问",
			}),
			makeEvent({
				id: "req-2:assistant",
				request_id: "req-2",
				role: "assistant",
				label: "输出",
				timestamp: "2026-07-24T10:00:03.000Z",
				content: "第二答",
			}),
		];

		expect(orderSessionTimeline(timeline, true).map((item) => item.content)).toEqual([
			"第一答",
			"第二答",
			"第二问",
			"第一问",
		]);
		expect(timeline.map((item) => item.content)).toEqual(["第一问", "第一答", "第二问", "第二答"]);
	});
});

describe("formatSessionKey", () => {
	it("优先显示 alias，并在缺少 alias 时安全截断 key hash", () => {
		expect(formatSessionKey({ alias: " qiran ", hash: "hash-value" })).toBe("qiran");
		expect(formatSessionKey({ alias: null, hash: "1234567890abcdefghijkl" })).toBe("12345678…ijkl");
		expect(formatSessionKey({ alias: null, hash: "" })).toBe("未知 Key");
	});
});

describe("parseIdeOpenedFilePrefixes", () => {
	it("将开头的 IDE 文件上下文与后续真实用户输入分开", () => {
		const content =
			"<ide_opened_file>The user opened the file s:\\Workspace\\Formal\\GameFantasyNetwork\\pacificx\\zs-unity\\Assets\\Resources\\prefab\\ui\\common\\UIFrostedGlassMask.prefab in the IDE. This may or may not be related to the current task.</ide_opened_file>\n\n" +
			"那么对比一下纯 Shader 和相机提取 Texture 的方法";

		expect(parseIdeOpenedFilePrefixes(content)).toEqual({
			contexts: [
				{
					path: "s:\\Workspace\\Formal\\GameFantasyNetwork\\pacificx\\zs-unity\\Assets\\Resources\\prefab\\ui\\common\\UIFrostedGlassMask.prefab",
					description:
						"The user opened the file s:\\Workspace\\Formal\\GameFantasyNetwork\\pacificx\\zs-unity\\Assets\\Resources\\prefab\\ui\\common\\UIFrostedGlassMask.prefab in the IDE. This may or may not be related to the current task.",
				},
			],
			remainingContent: "那么对比一下纯 Shader 和相机提取 Texture 的方法",
		});
	});

	it("不解析正文中间或未闭合的 IDE 标签", () => {
		const embedded = "请解释这个示例：<ide_opened_file>demo</ide_opened_file>";
		const incomplete = "<ide_opened_file>The user opened a file";

		expect(parseIdeOpenedFilePrefixes(embedded)).toEqual({ contexts: [], remainingContent: embedded });
		expect(parseIdeOpenedFilePrefixes(incomplete)).toEqual({ contexts: [], remainingContent: incomplete });
	});
});

describe("parseUserContextPrefixes", () => {
	it("按原始顺序拆分 system reminder、IDE 文件上下文和真实用户输入", () => {
		const content =
			"<system-reminder>第一行提醒\n第二行提醒</system-reminder>\n" +
			"<ide_opened_file>The user opened the file s:\\Workspace\\Demo.prefab in the IDE. This may or may not be related to the current task.</ide_opened_file>\n\n" +
			"继续分析这个 Prefab";

		expect(parseUserContextPrefixes(content)).toEqual({
			blocks: [
				{ kind: "system_reminder", content: "第一行提醒\n第二行提醒" },
				{
					kind: "ide_opened_file",
					context: {
						path: "s:\\Workspace\\Demo.prefab",
						description:
							"The user opened the file s:\\Workspace\\Demo.prefab in the IDE. This may or may not be related to the current task.",
					},
				},
			],
			remainingContent: "继续分析这个 Prefab",
		});
	});

	it("不解析正文中间或未闭合的 system reminder 标签", () => {
		const embedded = "请解释 <system-reminder>示例</system-reminder>";
		const incomplete = "<system-reminder>未结束";

		expect(parseUserContextPrefixes(embedded)).toEqual({ blocks: [], remainingContent: embedded });
		expect(parseUserContextPrefixes(incomplete)).toEqual({ blocks: [], remainingContent: incomplete });
	});

	it("将 transcript 与标签后的普通正文分开", () => {
		expect(
			parseUserContextPrefixes(
				"<transcript>User: 检查设置\n\nBash git status</transcript>\n\nErr on the side of blocking.",
			),
		).toEqual({
			blocks: [{ kind: "transcript", content: "User: 检查设置\n\nBash git status" }],
			remainingContent: "Err on the side of blocking.",
		});
	});
});

describe("parseTranscriptEntries", () => {
	it("保留多行用户内容，并将已知工具调用拆成独立记录", () => {
		expect(
			parseTranscriptEntries(
				"User: 第一行\n第二行\n\nBash git show abc --stat\n\nAssistant: 已检查\n\nAn ordinary English sentence.",
			),
		).toEqual([
			{ kind: "user", label: "用户", content: "第一行\n第二行" },
			{ kind: "tool", label: "工具", toolName: "Bash", content: "git show abc --stat" },
			{ kind: "assistant", label: "助手", content: "已检查" },
			{ kind: "text", label: "记录", content: "An ordinary English sentence." },
		]);
	});
});

describe("TranscriptView", () => {
	it("默认折叠，展开后按角色显示转录记录，并允许再次收起", () => {
		render(
			<TranscriptView
				content={
					"User: <ide_opened_file>The user opened the file c:\\Users\\gp68\\.codex\\config.toml in the IDE. This may or may not be related to the current task.</ide_opened_file>\n\n" +
					"User: 检查 settingsPanel\n\n" +
					"Bash git show abc --stat"
				}
			/>,
		);

		expect(screen.getByRole("region", { name: "会话转录" })).toBeInTheDocument();
		expect(screen.getByText("3 条记录")).toBeInTheDocument();
		const expandButton = screen.getByRole("button", { name: "展开会话转录" });
		expect(expandButton).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByRole("region", { name: "会话转录全文" })).not.toBeInTheDocument();
		expect(screen.queryByText("IDE 已打开文件")).not.toBeInTheDocument();

		fireEvent.click(expandButton);
		const collapseButton = screen.getByRole("button", { name: "收起会话转录" });
		expect(collapseButton).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("region", { name: "会话转录全文" })).toBeInTheDocument();
		expect(screen.getByText("IDE 已打开文件")).toBeInTheDocument();
		expect(screen.getByText("config.toml")).toBeInTheDocument();
		expect(screen.getByText("检查 settingsPanel")).toBeInTheDocument();
		expect(screen.getByText("Bash")).toBeInTheDocument();
		expect(screen.getByText("git show abc --stat")).toBeInTheDocument();

		fireEvent.click(collapseButton);
		expect(screen.getByRole("button", { name: "展开会话转录" })).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByRole("region", { name: "会话转录全文" })).not.toBeInTheDocument();
	});
});

describe("SystemReminderView", () => {
	it("默认折叠，并允许用户展开和收起全文", () => {
		render(<SystemReminderView content={"第一行提醒\n第二行提醒"} />);

		const expandButton = screen.getByRole("button", { name: "展开系统提醒" });
		expect(expandButton).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByRole("region", { name: "系统提醒全文" })).not.toBeInTheDocument();

		fireEvent.click(expandButton);
		const collapseButton = screen.getByRole("button", { name: "收起系统提醒" });
		expect(collapseButton).toHaveAttribute("aria-expanded", "true");
		expect(screen.getByRole("region", { name: "系统提醒全文" })).toHaveTextContent("第一行提醒 第二行提醒");

		fireEvent.click(collapseButton);
		expect(screen.getByRole("button", { name: "展开系统提醒" })).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByRole("region", { name: "系统提醒全文" })).not.toBeInTheDocument();
	});
});
