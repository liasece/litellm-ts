import { countInputTokens } from "./inputTokens";
it("does not tokenize inline binary images, audio or documents as prompt text", () => {
	for (const type of ["image_url", "input_image", "image", "input_audio", "input_file", "document"]) {
		const message = (binary: string) => [
			{
				role: "user",
				content: [
					{ type: "text", text: "Describe this attachment" },
					{
						type,
						image_url: { url: `data:image/png;base64,${binary}` },
						source: { type: "base64", data: binary },
						input_audio: { data: binary },
						file_data: binary,
					},
				],
			},
		];
		expect(countInputTokens(message("YWJj"))).toBe(countInputTokens(message("YWJj".repeat(5000))));
	}
});
it("still counts text in multimodal content and the complete tool schema", () => {
	const message = [
		{
			role: "user",
			content: [
				{ type: "text", text: "hi" },
				{ type: "image_url", image_url: { url: "https://example.invalid/img" } },
			],
		},
	];
	expect(countInputTokens([{ role: "user", content: [{ type: "text", text: "hi ".repeat(500) }] }])).toBeGreaterThan(
		countInputTokens(message),
	);
	expect(
		countInputTokens(message, [{ type: "function", function: { name: "search", description: "schema ".repeat(500) } }]),
	).toBeGreaterThan(countInputTokens(message));
});
