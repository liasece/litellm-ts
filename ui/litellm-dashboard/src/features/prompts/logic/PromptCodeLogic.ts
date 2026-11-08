export interface PromptCodeInput {
	apiBase: string;
	effectiveApiKey: string;
	model: string;
	promptId: string;
	promptVariables?: Record<string, string>;
	version?: string;
	selectedLanguage: "curl" | "python" | "javascript";
	selectedTab: string;
}
export function generatePromptCode(input: PromptCodeInput): string {
	const { apiBase, effectiveApiKey, model, promptId, promptVariables = {}, version = "1", selectedLanguage, selectedTab } = input;
	const hasVariables = Object.keys(promptVariables).length > 0;

	if (selectedLanguage === "curl") {
		if (selectedTab === "basic") {
			return `curl -X POST '${apiBase}/chat/completions' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${effectiveApiKey}' \\
  -d '{
    "model": "${model}",
    "prompt_id": "${promptId}"${
		hasVariables
			? `,
    "prompt_variables": ${JSON.stringify(promptVariables, null, 6).replace(/\n/g, "\n    ")}`
			: ""
	}
  }' | jq`;
		} else if (selectedTab === "messages") {
			return `curl -X POST '${apiBase}/chat/completions' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${effectiveApiKey}' \\
  -d '{
    "model": "${model}",
    "prompt_id": "${promptId}"${
		hasVariables
			? `,
    "prompt_variables": ${JSON.stringify(promptVariables, null, 6).replace(/\n/g, "\n    ")}`
			: ""
	},
    "messages": [
      {
        "role": "user",
        "content": "hi"
      }
    ]
  }' | jq`;
		} else {
			return `curl -X POST '${apiBase}/chat/completions' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer ${effectiveApiKey}' \\
  -d '{
    "model": "${model}",
    "prompt_id": "${promptId}",
    "prompt_version": ${version},
    "messages": [
      {
        "role": "user",
        "content": "Who are u"
      }
    ]
  }' | jq`;
		}
	} else if (selectedLanguage === "python") {
		const importCode = `import openai

client = openai.OpenAI(
    api_key="${effectiveApiKey}",
    base_url="${apiBase}"
)
`;
		if (selectedTab === "basic") {
			return `${importCode}
response = client.chat.completions.create(
    model="${model}",
    extra_body={
        "prompt_id": "${promptId}"${
			hasVariables
				? `,
        "prompt_variables": ${JSON.stringify(promptVariables, null, 8).replace(/\n/g, "\n        ")}`
				: ""
		}
    }
)

print(response)`;
		} else if (selectedTab === "messages") {
			return `${importCode}
response = client.chat.completions.create(
    model="${model}",
    messages=[
        {"role": "user", "content": "hi"}
    ],
    extra_body={
        "prompt_id": "${promptId}"${
			hasVariables
				? `,
        "prompt_variables": ${JSON.stringify(promptVariables, null, 8).replace(/\n/g, "\n        ")}`
				: ""
		}
    }
)

print(response)`;
		} else {
			return `${importCode}
response = client.chat.completions.create(
    model="${model}",
    messages=[
        {"role": "user", "content": "Who are u"}
    ],
    extra_body={
        "prompt_id": "${promptId}",
        "prompt_version": ${version}
    }
)

print(response)`;
		}
	} else {
		// JavaScript/Node.js
		const importCode = `import OpenAI from 'openai';

const client = new OpenAI({
    apiKey: "${effectiveApiKey}",
    baseURL: "${apiBase}"
});
`;
		if (selectedTab === "basic") {
			return `${importCode}
async function main() {
    const response = await client.chat.completions.create({
        model: "${model}",
        ${
			hasVariables
				? `prompt_id: "${promptId}",
        prompt_variables: ${JSON.stringify(promptVariables, null, 8).replace(/\n/g, "\n        ")}`
				: `prompt_id: "${promptId}"`
		}
    });
    
    console.log(response);
}

main();`;
		} else if (selectedTab === "messages") {
			return `${importCode}
async function main() {
    const response = await client.chat.completions.create({
        model: "${model}",
        messages: [
            { role: "user", content: "hi" }
        ],
        ${
			hasVariables
				? `prompt_id: "${promptId}",
        prompt_variables: ${JSON.stringify(promptVariables, null, 8).replace(/\n/g, "\n        ")}`
				: `prompt_id: "${promptId}"`
		}
    });
    
    console.log(response);
}

main();`;
		} else {
			return `${importCode}
async function main() {
    const response = await client.chat.completions.create({
        model: "${model}",
        messages: [
            { role: "user", content: "Who are u" }
        ],
        prompt_id: "${promptId}",
        prompt_version: ${version}
    });
    
    console.log(response);
}

main();`;
		}
	}
}
