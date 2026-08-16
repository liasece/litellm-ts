import { Tabs, Tag, Typography } from "antd";
import { useMemo, useState } from "react";

const { Text } = Typography;

// 折叠未变化块时首尾各保留的行数：保留足够上下文，中间部分折叠为可点击展开的占位行。
const CONTEXT_LINES = 50;
const MAX_LCS_CELLS = 4_000_000;

type DiffTabKey = "request" | "response";
type DiffLineKind = "context" | "change";

interface DiffLine {
	text: string;
	lineNumber: number;
}

interface DiffRow {
	kind: DiffLineKind;
	left?: DiffLine;
	right?: DiffLine;
}

type FoldedDiffRow = DiffRow | { kind: "fold"; hidden: DiffRow[] };

interface UpstreamDownstreamDiffProps {
	downstreamRequest: unknown;
	upstreamRequest: unknown;
	downstreamResponse: unknown;
	upstreamResponse: unknown;
}

interface DiffViewProps {
	left: unknown;
	right: unknown;
	leftLabel: string;
	rightLabel: string;
}

type EditOperation = { kind: "equal"; text: string } | { kind: "remove"; text: string } | { kind: "add"; text: string };

interface PatienceAnchor {
	leftIndex: number;
	rightIndex: number;
}

/**
 * Renders the provider-side and proxy-side payloads as a compact, Git-like diff.
 * The component owns the diff algorithm and presentation so the log drawer only
 * needs to provide the four recorded request/response values.
 */
export function UpstreamDownstreamDiff({
	downstreamRequest,
	upstreamRequest,
	downstreamResponse,
	upstreamResponse,
}: UpstreamDownstreamDiffProps) {
	const [activeTab, setActiveTab] = useState<DiffTabKey>("request");
	const hasResponseDiff = upstreamResponse !== undefined && upstreamResponse !== null;

	return (
		<div data-testid="upstream-downstream-diff">
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					marginBottom: 8,
				}}
			>
				<InlineLegend />
				<Text type="secondary" style={{ fontSize: 12 }}>
					Unchanged blocks are folded
				</Text>
			</div>
			<Tabs
				activeKey={activeTab}
				onChange={(key) => setActiveTab(key as DiffTabKey)}
				items={[
					{
						key: "request",
						label: "Request",
						children: (
							<DiffView left={downstreamRequest} right={upstreamRequest} leftLabel="Downstream" rightLabel="Upstream" />
						),
					},
					...(hasResponseDiff
						? [
								{
									key: "response",
									label: "Response",
									children: (
										<DiffView
											left={downstreamResponse}
											right={upstreamResponse}
											leftLabel="Downstream"
											rightLabel="Upstream"
										/>
									),
								},
							]
						: []),
				]}
			/>
		</div>
	);
}

function InlineLegend() {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
			<Tag color="red" style={{ margin: 0 }}>
				− Downstream only
			</Tag>
			<Tag color="green" style={{ margin: 0 }}>
				＋ Upstream only
			</Tag>
		</div>
	);
}

function DiffView({ left, right, leftLabel, rightLabel }: DiffViewProps) {
	const leftText = formatDiffValue(left);
	const rightText = formatDiffValue(right);
	const rows = useMemo(() => buildFoldedDiffRows(leftText, rightText), [leftText, rightText]);
	const isIdentical = leftText === rightText;

	return (
		<div>
			{isIdentical ? (
				<div
					style={{
						padding: "24px 16px",
						textAlign: "center",
						border: "1px solid #d0d7de",
						borderRadius: 6,
						background: "#f6f8fa",
					}}
				>
					<Text type="secondary">No differences — the recorded payloads are identical.</Text>
				</div>
			) : (
				<DiffTable rows={rows} leftLabel={leftLabel} rightLabel={rightLabel} />
			)}
		</div>
	);
}

function DiffTable({ rows, leftLabel, rightLabel }: { rows: FoldedDiffRow[]; leftLabel: string; rightLabel: string }) {
	const [expandedFolds, setExpandedFolds] = useState<Set<number>>(() => new Set());

	return (
		<div
			style={{
				border: "1px solid #d0d7de",
				borderRadius: 6,
				overflow: "hidden",
				fontFamily: "ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Consolas, monospace",
				fontSize: 12,
			}}
		>
			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr",
					background: "#f6f8fa",
					borderBottom: "1px solid #d0d7de",
					fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
					fontSize: 12,
					fontWeight: 600,
				}}
			>
				<div style={{ padding: "8px 12px", borderRight: "1px solid #d0d7de" }}>{leftLabel}</div>
				<div style={{ padding: "8px 12px" }}>{rightLabel}</div>
			</div>
			<div style={{ maxHeight: 460, overflow: "auto" }}>
				{rows.map((row, index) => {
					if (row.kind === "fold") {
						const isExpanded = expandedFolds.has(index);
						return isExpanded ? (
							<div key={`expanded-${index}`}>
								{row.hidden?.map((hiddenRow, hiddenIndex) => (
									<DiffTableRow key={`hidden-${index}-${hiddenIndex}`} row={hiddenRow} />
								))}
							</div>
						) : (
							<button
								key={`fold-${index}`}
								type="button"
								aria-label={`Expand ${row.hidden?.length ?? 0} unchanged lines`}
								onClick={() =>
									setExpandedFolds((current) => {
										const next = new Set(current);
										next.add(index);
										return next;
									})
								}
								style={{
									display: "block",
									width: "100%",
									padding: "6px 12px",
									border: 0,
									borderBottom: "1px solid #d0d7de",
									background: "#ddf4ff",
									color: "#0969da",
									cursor: "pointer",
									textAlign: "left",
								}}
							>
								⋮ {row.hidden?.length ?? 0} unchanged lines — click to expand
							</button>
						);
					}

					return <DiffTableRow key={`row-${index}`} row={row} />;
				})}
			</div>
		</div>
	);
}

function DiffTableRow({ row }: { row: DiffRow }) {
	const leftBackground = row.kind === "change" ? "#ffebe9" : "#ffffff";
	const rightBackground = row.kind === "change" ? "#e6ffec" : "#ffffff";

	return (
		<div
			data-diff-kind={row.kind}
			style={{
				display: "grid",
				gridTemplateColumns: "1fr 1fr",
				borderBottom: "1px solid #f0f2f4",
			}}
		>
			<DiffCell line={row.left} background={leftBackground} marker={row.kind === "change" ? "−" : " "} />
			<DiffCell line={row.right} background={rightBackground} marker={row.kind === "change" ? "+" : " "} />
		</div>
	);
}

function DiffCell({ line, background, marker }: { line?: DiffLine; background: string; marker: string }) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "42px minmax(0, 1fr)",
				minHeight: 22,
				background,
				borderRight: "1px solid #d0d7de",
			}}
		>
			<div style={{ padding: "2px 8px", color: "#6e7781", textAlign: "right", userSelect: "none" }}>
				{line?.lineNumber ?? ""}
			</div>
			<pre
				style={{
					margin: 0,
					padding: "2px 8px 2px 0",
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					color: line ? "#24292f" : "#8c959f",
				}}
			>
				<span style={{ display: "inline-block", width: 16, color: marker === "+" ? "#1a7f37" : "#cf222e" }}>
					{marker}
				</span>
				{line?.text ?? ""}
			</pre>
		</div>
	);
}

function formatDiffValue(value: unknown): string {
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return JSON.stringify(parsed, null, 2);
		} catch {
			return value;
		}
	}

	if (value === undefined) return "";
	if (value === null) return "null";

	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function buildFoldedDiffRows(leftText: string, rightText: string): FoldedDiffRow[] {
	const operations = buildEditOperations(leftText.split("\n"), rightText.split("\n"));
	const rows: DiffRow[] = [];
	let leftLineNumber = 1;
	let rightLineNumber = 1;

	for (let index = 0; index < operations.length; ) {
		const operation = operations[index];
		if (operation.kind === "equal") {
			rows.push({
				kind: "context",
				left: { text: operation.text, lineNumber: leftLineNumber++ },
				right: { text: operation.text, lineNumber: rightLineNumber++ },
			});
			index += 1;
			continue;
		}

		const removed: string[] = [];
		const added: string[] = [];
		while (index < operations.length && operations[index].kind !== "equal") {
			if (operations[index].kind === "remove") removed.push(operations[index].text);
			if (operations[index].kind === "add") added.push(operations[index].text);
			index += 1;
		}

		const changeCount = Math.max(removed.length, added.length);
		for (let offset = 0; offset < changeCount; offset += 1) {
			rows.push({
				kind: "change",
				left: removed[offset] === undefined ? undefined : { text: removed[offset], lineNumber: leftLineNumber++ },
				right: added[offset] === undefined ? undefined : { text: added[offset], lineNumber: rightLineNumber++ },
			});
		}
	}

	return foldContextRows(rows);
}

function buildEditOperations(leftLines: string[], rightLines: string[]): EditOperation[] {
	if (leftLines.length * rightLines.length > MAX_LCS_CELLS) {
		return buildPatienceEditOperations(leftLines, rightLines);
	}
	return buildLcsEditOperations(leftLines, rightLines);
}

function buildLcsEditOperations(leftLines: string[], rightLines: string[]): EditOperation[] {
	const columns = rightLines.length + 1;
	const table = Array.from({ length: leftLines.length + 1 }, () => new Uint32Array(columns));
	for (let leftIndex = 1; leftIndex <= leftLines.length; leftIndex += 1) {
		for (let rightIndex = 1; rightIndex <= rightLines.length; rightIndex += 1) {
			table[leftIndex][rightIndex] =
				leftLines[leftIndex - 1] === rightLines[rightIndex - 1]
					? table[leftIndex - 1][rightIndex - 1] + 1
					: Math.max(table[leftIndex - 1][rightIndex], table[leftIndex][rightIndex - 1]);
		}
	}

	const operations: EditOperation[] = [];
	let leftIndex = leftLines.length;
	let rightIndex = rightLines.length;
	while (leftIndex > 0 || rightIndex > 0) {
		if (leftIndex > 0 && rightIndex > 0 && leftLines[leftIndex - 1] === rightLines[rightIndex - 1]) {
			operations.push({ kind: "equal", text: leftLines[leftIndex - 1] });
			leftIndex -= 1;
			rightIndex -= 1;
		} else if (
			leftIndex > 0 &&
			(rightIndex === 0 || table[leftIndex - 1][rightIndex] >= table[leftIndex][rightIndex - 1])
		) {
			operations.push({ kind: "remove", text: leftLines[leftIndex - 1] });
			leftIndex -= 1;
		} else {
			operations.push({ kind: "add", text: rightLines[rightIndex - 1] });
			rightIndex -= 1;
		}
	}

	return operations.reverse();
}

function buildPatienceEditOperations(leftLines: string[], rightLines: string[]): EditOperation[] {
	const operations: EditOperation[] = [];
	appendPatienceRange(operations, leftLines, 0, leftLines.length, rightLines, 0, rightLines.length);
	return operations;
}

function appendPatienceRange(
	operations: EditOperation[],
	leftLines: string[],
	initialLeftStart: number,
	initialLeftEnd: number,
	rightLines: string[],
	initialRightStart: number,
	initialRightEnd: number,
): void {
	let leftStart = initialLeftStart;
	let rightStart = initialRightStart;
	while (
		leftStart < initialLeftEnd &&
		rightStart < initialRightEnd &&
		leftLines[leftStart] === rightLines[rightStart]
	) {
		operations.push({ kind: "equal", text: leftLines[leftStart] });
		leftStart += 1;
		rightStart += 1;
	}

	let leftEnd = initialLeftEnd;
	let rightEnd = initialRightEnd;
	while (leftEnd > leftStart && rightEnd > rightStart && leftLines[leftEnd - 1] === rightLines[rightEnd - 1]) {
		leftEnd -= 1;
		rightEnd -= 1;
	}

	if (leftStart === leftEnd) {
		for (let index = rightStart; index < rightEnd; index += 1) {
			operations.push({ kind: "add", text: rightLines[index] });
		}
	} else if (rightStart === rightEnd) {
		for (let index = leftStart; index < leftEnd; index += 1) {
			operations.push({ kind: "remove", text: leftLines[index] });
		}
	} else {
		const anchors = findPatienceAnchors(leftLines, leftStart, leftEnd, rightLines, rightStart, rightEnd);
		if (anchors.length === 0) {
			const leftSegment = leftLines.slice(leftStart, leftEnd);
			const rightSegment = rightLines.slice(rightStart, rightEnd);
			if (leftSegment.length * rightSegment.length <= MAX_LCS_CELLS) {
				operations.push(...buildLcsEditOperations(leftSegment, rightSegment));
			} else {
				for (const line of leftSegment) operations.push({ kind: "remove", text: line });
				for (const line of rightSegment) operations.push({ kind: "add", text: line });
			}
		} else {
			let previousLeft = leftStart;
			let previousRight = rightStart;
			for (const anchor of anchors) {
				appendPatienceRange(
					operations,
					leftLines,
					previousLeft,
					anchor.leftIndex,
					rightLines,
					previousRight,
					anchor.rightIndex,
				);
				operations.push({ kind: "equal", text: leftLines[anchor.leftIndex] });
				previousLeft = anchor.leftIndex + 1;
				previousRight = anchor.rightIndex + 1;
			}
			appendPatienceRange(operations, leftLines, previousLeft, leftEnd, rightLines, previousRight, rightEnd);
		}
	}

	const suffixLength = initialLeftEnd - leftEnd;
	for (let offset = 0; offset < suffixLength; offset += 1) {
		operations.push({ kind: "equal", text: leftLines[leftEnd + offset] });
	}
}

function findPatienceAnchors(
	leftLines: string[],
	leftStart: number,
	leftEnd: number,
	rightLines: string[],
	rightStart: number,
	rightEnd: number,
): PatienceAnchor[] {
	const leftUnique = uniqueLinePositions(leftLines, leftStart, leftEnd);
	const rightUnique = uniqueLinePositions(rightLines, rightStart, rightEnd);
	const pairs: PatienceAnchor[] = [];
	for (let leftIndex = leftStart; leftIndex < leftEnd; leftIndex += 1) {
		const line = leftLines[leftIndex];
		if (leftUnique.get(line) !== leftIndex) continue;
		const rightIndex = rightUnique.get(line);
		if (rightIndex !== undefined) pairs.push({ leftIndex: leftIndex, rightIndex: rightIndex });
	}
	if (pairs.length <= 1) return pairs;

	const tails: number[] = [];
	const previous = new Int32Array(pairs.length);
	previous.fill(-1);
	for (let index = 0; index < pairs.length; index += 1) {
		let low = 0;
		let high = tails.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (pairs[tails[middle]].rightIndex < pairs[index].rightIndex) low = middle + 1;
			else high = middle;
		}
		if (low > 0) previous[index] = tails[low - 1];
		tails[low] = index;
	}

	const anchors: PatienceAnchor[] = [];
	let current = tails[tails.length - 1];
	while (current !== undefined && current >= 0) {
		anchors.push(pairs[current]);
		current = previous[current];
	}
	return anchors.reverse();
}

function uniqueLinePositions(lines: string[], start: number, end: number): Map<string, number> {
	const positions = new Map<string, number>();
	const duplicates = new Set<string>();
	for (let index = start; index < end; index += 1) {
		const line = lines[index];
		if (positions.has(line)) duplicates.add(line);
		else positions.set(line, index);
	}
	for (const line of duplicates) positions.delete(line);
	return positions;
}

function foldContextRows(rows: DiffRow[]): FoldedDiffRow[] {
	if (!rows.some((row) => row.kind === "change")) return rows;

	const foldedRows: FoldedDiffRow[] = [];
	for (let index = 0; index < rows.length; ) {
		if (rows[index].kind === "change") {
			foldedRows.push(rows[index]);
			index += 1;
			continue;
		}

		const contextStart = index;
		while (index < rows.length && rows[index].kind === "context") index += 1;
		const contextRows = rows.slice(contextStart, index);
		if (contextRows.length <= CONTEXT_LINES * 2 + 1) {
			foldedRows.push(...contextRows);
		} else {
			foldedRows.push(...contextRows.slice(0, CONTEXT_LINES));
			foldedRows.push({ kind: "fold", hidden: contextRows.slice(CONTEXT_LINES, -CONTEXT_LINES) });
			foldedRows.push(...contextRows.slice(-CONTEXT_LINES));
		}
	}

	return foldedRows;
}
