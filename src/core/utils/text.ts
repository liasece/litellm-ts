/**
 * Clean UTF-16 surrogates from text, replacing with replacement character
 * @param text
 */
export function cleanSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDFFF]/gu, "�");
}
