export async function copyText(text: string): Promise<void> {
	if (navigator.clipboard && window.isSecureContext) {
		await navigator.clipboard.writeText(text);
		return;
	}
	const input = document.createElement("textarea"),
		focused = document.activeElement;
	input.value = text;
	input.style.position = "fixed";
	input.style.opacity = "0";
	document.body.appendChild(input);
	try {
		input.focus();
		input.select();
		document.execCommand("copy");
	} finally {
		input.remove();
		if (focused instanceof HTMLElement) focused.focus();
	}
}
