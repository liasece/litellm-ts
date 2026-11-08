let sequence = 0;
export function nextUiIdentity(prefix: string): string {
	return prefix + "-" + ++sequence;
}
