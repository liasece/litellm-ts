export const initialTransformRequest = JSON.stringify(
	{
		model: "openai/gpt-4o",
		messages: [
			{ role: "system", content: "You are a helpful assistant." },
			{ role: "user", content: "Explain quantum computing in simple terms" },
		],
		temperature: 0.7,
		max_tokens: 500,
		stream: true,
	},
	null,
	2,
);
export const transformExampleCurl = `curl -X POST \\
  https://api.openai.com/v1/chat/completions \\
  -H 'Authorization: Bearer sk-xxx' \\
  -H 'Content-Type: application/json' \\
  -d '{
  "model": "gpt-4",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    }
  ],
  "temperature": 0.7
  }'`;
