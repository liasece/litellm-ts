let context: CanvasRenderingContext2D | null | undefined;
export function measureUsageTickText(text: string, fontSize: number): number {
	if (context === undefined) context = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
	if (!context) return text.length * fontSize * 0.6;
	context.font = fontSize + "px ui-sans-serif, system-ui, sans-serif";
	return context.measureText(text).width;
}
