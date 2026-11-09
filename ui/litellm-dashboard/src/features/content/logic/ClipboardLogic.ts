import { messageManager } from "../../notifications/logic/MessageManager";

/** 模态 dialog 打开时页面其余部分不可聚焦，textarea 必须放进最上层的 dialog。 */
function copyContainer(): HTMLElement {
	const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
	return dialogs.length ? dialogs[dialogs.length - 1] : document.body;
}

/** 用隐藏 textarea 选中文本后交给 execCommand，兼容非安全上下文和拒绝异步剪贴板的浏览器。 */
function copyWithSelection(text: string): boolean {
	if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
	const focused = document.activeElement;
	const selection = document.getSelection();
	const ranges: Range[] = [];
	if (selection) {
		for (let index = 0; index < selection.rangeCount; index += 1) ranges.push(selection.getRangeAt(index).cloneRange());
	}
	const input = document.createElement("textarea");
	input.value = text;
	input.setAttribute("readonly", "");
	input.style.position = "fixed";
	input.style.top = "0";
	input.style.left = "-9999px";
	input.style.opacity = "0";
	input.style.pointerEvents = "none";
	copyContainer().appendChild(input);
	try {
		input.focus();
		input.select();
		input.setSelectionRange(0, input.value.length);
		return document.execCommand("copy");
	} catch {
		return false;
	} finally {
		input.remove();
		if (focused instanceof HTMLElement) focused.focus();
		if (selection) {
			try {
				selection.removeAllRanges();
				for (const range of ranges) selection.addRange(range);
			} catch {
				// 恢复原选区失败不影响复制结果。
			}
		}
	}
}

/**
 * 复制文本到剪贴板。
 *
 * 异步剪贴板只在安全上下文可用；仪表盘同时通过局域网 HTTP 入口访问，浏览器也可能拒绝写入权限。
 * 因此先尝试异步剪贴板，失败或不可用时回退到 execCommand，全部失败才提示并抛出，避免界面误显示“已复制”。
 */
export async function copyText(text: string): Promise<void> {
	if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
		try {
			await navigator.clipboard.writeText(text);
			return;
		} catch {
			// 权限被拒绝或文档未聚焦时继续尝试兼容路径。
		}
	}
	if (copyWithSelection(text)) return;
	messageManager.error("Copy failed. Please check your browser clipboard permissions and try again.");
	throw new Error("Clipboard copy failed");
}
