package chatcompletions

import (
	"encoding/json"
	"strings"
	"testing"

	"commandcode-go-cliproxyapi/internal/adapter/shared"
	"commandcode-go-cliproxyapi/internal/errclass"
)

// namespaceToolsBody is the shape Codex and MCP clients send: a Responses
// request whose tools mix plain functions with namespace groups. CommandCode
// has no nesting on any route, so every namespace must be flattened into one
// function per nested tool instead of being rejected the way
// TestResponsesUnsupportedToolTypeRejected pins for genuinely untranslatable
// types. Regression for the production 500 "unsupported tool type
// \"namespace\"; only function tools translate to /v1/chat/completions".
const namespaceToolsBody = `{
  "input": "hi",
  "tools": [
    {"type":"function","name":"exec_command","parameters":{"type":"object"}},
    {
      "type":"namespace",
      "name":"mcp__node_repl",
      "description":"Run JavaScript",
      "tools": [
        {"type":"function","name":"js","description":"Evaluate","parameters":{"type":"object"}},
        {"type":"function","name":"reset","parameters":{"type":"object"}}
      ]
    },
    {
      "type":"namespace",
      "name":"multi_agent_v1",
      "tools": [{"type":"function","name":"close_agent","parameters":{"type":"object"}}]
    }
  ]
}`

func TestNamespaceToolsFlattenForChatTarget(t *testing.T) {
	out, namespaced, eErr := BuildRequestWithTools("m", "openai-response", []byte(namespaceToolsBody), nil, nil)
	if eErr != nil {
		t.Fatalf("namespace tools must flatten, not fail: %v", eErr)
	}
	var body struct {
		Tools []struct {
			Type     string `json:"type"`
			Function struct {
				Name        string `json:"name"`
				Description string `json:"description"`
			} `json:"function"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(out, &body); err != nil {
		t.Fatalf("output is not JSON: %v", err)
	}
	// One entry per nested tool: 1 plain + 2 + 1 — no namespace entries left,
	// because the Chat wire has no such type.
	want := []string{"exec_command", "mcp__node_repl__js", "mcp__node_repl__reset", "multi_agent_v1__close_agent"}
	if len(body.Tools) != len(want) {
		t.Fatalf("tool count = %d, want %d (%+v)", len(body.Tools), len(want), body.Tools)
	}
	for i, name := range want {
		if body.Tools[i].Type != "function" {
			t.Fatalf("tool %d type = %q, want function", i, body.Tools[i].Type)
		}
		if body.Tools[i].Function.Name != name {
			t.Fatalf("tool %d name = %q, want %q", i, body.Tools[i].Function.Name, name)
		}
	}
	// The nested description wins; the group description is the fallback.
	if got := body.Tools[1].Function.Description; got != "Evaluate" {
		t.Fatalf("nested description = %q", got)
	}
	// The index the response leg needs is populated for every flattened name.
	if len(namespaced) != 3 {
		t.Fatalf("namespaced index = %+v", namespaced)
	}
	if namespaced["mcp__node_repl__js"] != "mcp__node_repl" {
		t.Fatalf("index entry = %q", namespaced["mcp__node_repl__js"])
	}
}

func TestNamespaceToolsRestoreOnResponse(t *testing.T) {
	_, namespaced, eErr := BuildRequestWithTools("m", "openai-response", []byte(namespaceToolsBody), nil, nil)
	if eErr != nil {
		t.Fatalf("build: %v", eErr)
	}
	body := `{"id":"cc_1","model":"m","choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"mcp__node_repl__js","arguments":"{}"}}]}}]}`
	out, eErr := ConvertNonStreamResponseWithTools("openai-response", 200, []byte(body), namespaced)
	if eErr != nil {
		t.Fatalf("convert: %v", eErr)
	}
	var resp struct {
		Output []struct {
			Type      string `json:"type"`
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"output"`
	}
	if err := json.Unmarshal(out, &resp); err != nil {
		t.Fatalf("output is not JSON: %v", err)
	}
	if len(resp.Output) != 1 {
		t.Fatalf("output = %+v", resp.Output)
	}
	// The client declared (mcp__node_repl, js); it must get that back, not
	// the flattened wire name it never sent.
	if resp.Output[0].Name != "js" || resp.Output[0].Namespace != "mcp__node_repl" {
		t.Fatalf("restored identity = %+v", resp.Output[0])
	}
}

func TestNamespaceToolsLeavePlainCallsAlone(t *testing.T) {
	body := `{"id":"cc_1","model":"m","choices":[{"index":0,"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"exec_command","arguments":"{}"}}]}}]}`
	out, eErr := ConvertNonStreamResponseWithTools("openai-response", 200, []byte(body), shared.ToolNames{})
	if eErr != nil {
		t.Fatalf("convert: %v", eErr)
	}
	if strings.Contains(string(out), "\"namespace\"") {
		t.Fatalf("plain function call must not gain a namespace member: %s", out)
	}
}

func TestNamespaceToolNameIsBoundedAndStable(t *testing.T) {
	long := strings.Repeat("x", 80)
	got := shared.NamespacedToolName(long, long, shared.MaxToolNameLen)
	if len(got) > shared.MaxToolNameLen {
		t.Fatalf("flattened name too long (%d): %q", len(got), got)
	}
	if again := shared.NamespacedToolName(long, long, shared.MaxToolNameLen); again != got {
		t.Fatalf("non-deterministic: %q vs %q", got, again)
	}
	// Distinct pairs must not collide onto one truncated name.
	other := shared.NamespacedToolName(long, long+"y", shared.MaxToolNameLen)
	if other == got {
		t.Fatalf("collision between distinct namespaces: %q", got)
	}
}

func TestNamespaceWithNonFunctionNestedToolStillRejected(t *testing.T) {
	// A namespace wrapping a type nothing can translate must still fail
	// descriptively instead of silently dropping that tool.
	body := `{"input":"hi","tools":[{"type":"namespace","name":"ns","tools":[{"type":"web_search"}]}]}`
	_, _, eErr := BuildRequestWithTools("m", "openai-response", []byte(body), nil, nil)
	if eErr == nil || eErr.Class != errclass.ClassUnsupported {
		t.Fatalf("want ClassUnsupported, got %+v", eErr)
	}
}
