let probe: HTMLSpanElement | undefined;
const measurements = new Map<string, { width: number; height: number }>();
let initialLayout = true;
/**
 * Original Recharts caches the first16px/24px span measurements while its axis
 * switches to10px. Labels first encountered after that layout use10px/15px.
 * Preserve that chart-local observed cache lifecycle, without a global CSS change.
 */
export function completeSpeedTickMeasurement(): void {
	initialLayout = false;
}
export function measureSpeedTickText(label: string): { width: number; height: number } {
	const cached = measurements.get(label);
	if (cached) return cached;
	const pixels = initialLayout ? 16 : 10;
	if (typeof document === "undefined") return { width: label.length * pixels * 0.6, height: pixels * 1.5 };
	if (!probe) {
		probe = document.createElement("span");
		probe.setAttribute("aria-hidden", "true");
		Object.assign(probe.style, {
			position: "absolute",
			top: "-20000px",
			left: "0",
			visibility: "hidden",
			padding: "0",
			margin: "0",
			border: "none",
			whiteSpace: "pre",
			transition: "none",
		});
		document.body.appendChild(probe);
	}
	probe.style.font = pixels + "px/" + pixels * 1.5 + "px var(--ui-font-sans)";
	probe.textContent = label;
	const rect = probe.getBoundingClientRect(),
		size = { width: rect.width, height: rect.height };
	if (measurements.size > 2000) measurements.clear();
	measurements.set(label, size);
	return size;
}
