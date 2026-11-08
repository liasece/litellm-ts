export async function copyToolText(text: string): Promise<boolean> {
	let area: HTMLTextAreaElement | undefined;
	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return true;
		}
		area = document.createElement("textarea");
		area.value = text;
		area.style.position = "fixed";
		area.style.opacity = "0";
		document.body.appendChild(area);
		area.focus();
		area.select();
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		area?.remove();
	}
}
