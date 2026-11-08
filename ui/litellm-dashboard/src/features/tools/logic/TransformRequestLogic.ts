export function formatTransformCurl(apiBase: string, body: unknown, headers: Record<string, string>): string {
	const formatted = JSON.stringify(body, null, 2)
		.split("\n")
		.map((line) => "  " + line)
		.join("\n");
	const header = Object.entries(headers)
		.map(([name, value]) => "-H '" + name + ": " + value + "'")
		.join(" \\\n  ");
	return (
		"curl -X POST \\\n  " +
		apiBase +
		" \\\n  " +
		(header ? header + " \\\n  " : "") +
		"-H 'Content-Type: application/json' \\\n  -d '{\n" +
		formatted +
		"\n  }'"
	);
}
