export function formatKeyTimestamp(timestamp: string | Date) {
	const date = new Date(timestamp);
	const datePart = date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	const timePart = date.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	});
	return `${datePart} at ${timePart}`;
}
