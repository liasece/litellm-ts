package chatcompletions

import (
	"strings"
	"testing"

	"commandcode-go-cliproxyapi/internal/adapter/shared"
)

// The production failure was a STREAMING Responses request, so the stream leg
// needs its own pin: a tool call the request leg flattened must be re-announced
// under the namespace the client declared, and a plain tool must not gain a
// namespace member.
func TestNamespaceRestoredInResponsesStream(t *testing.T) {
	_, namespaced, eErr := BuildRequestWithTools("m", "openai-response", []byte(namespaceToolsBody), nil, nil)
	if eErr != nil {
		t.Fatalf("build: %v", eErr)
	}

	upstream := [][]byte{
		[]byte(`{"id":"cc_1","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"mcp__node_repl__js","arguments":"{}"}}]}}]}`),
		[]byte(`{"id":"cc_1","model":"m","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`),
		[]byte("[DONE]"),
	}

	conv := NewStreamConverterWithTools("openai-response", namespaced)
	var frames [][]byte
	for i, payload := range upstream {
		evs, done, eErr := conv.Feed(append(append([]byte("data: "), payload...), '\n'))
		if eErr != nil {
			t.Fatalf("feed %d: %v", i, eErr)
		}
		frames = append(frames, evs...)
		if i == len(upstream)-1 && !done {
			t.Fatalf("stream not done after [DONE]")
		}
	}

	var added, doneItem, terminal map[string]any
	for _, evt := range parseEvents(t, frames) {
		payload := evt.Data
		switch payload["type"] {
		case "response.output_item.added":
			if item, ok := payload["item"].(map[string]any); ok && item["type"] == "function_call" {
				added = item
			}
		case "response.output_item.done":
			if item, ok := payload["item"].(map[string]any); ok && item["type"] == "function_call" {
				doneItem = item
			}
		case "response.completed":
			terminal, _ = payload["response"].(map[string]any)
		}
	}
	if added == nil || doneItem == nil || terminal == nil {
		t.Fatalf("missing function_call events: added=%v done=%v terminal=%v", added, doneItem, terminal)
	}
	// The client declared (mcp__node_repl, js): the announcement, the done
	// item, and the terminal output must all report that identity rather
	// than the flattened wire name the client never sent.
	for name, item := range map[string]map[string]any{"added": added, "done": doneItem} {
		if item["name"] != "js" || item["namespace"] != "mcp__node_repl" {
			t.Fatalf("%s identity = %+v", name, item)
		}
	}
	output, _ := terminal["output"].([]any)
	if len(output) != 1 {
		t.Fatalf("terminal output = %+v", output)
	}
	first, _ := output[0].(map[string]any)
	if first["name"] != "js" || first["namespace"] != "mcp__node_repl" {
		t.Fatalf("terminal identity = %+v", first)
	}
}

func TestPlainToolStreamHasNoNamespaceMember(t *testing.T) {
	conv := NewStreamConverterWithTools("openai-response", shared.ToolNames{})
	var frames [][]byte
	for _, payload := range []string{
		`{"id":"cc_1","model":"m","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"exec_command","arguments":"{}"}}]}}]}`,
		`{"id":"cc_1","model":"m","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
		"[DONE]",
	} {
		evs, _, eErr := conv.Feed(append(append([]byte("data: "), []byte(payload)...), '\n'))
		if eErr != nil {
			t.Fatalf("feed: %v", eErr)
		}
		frames = append(frames, evs...)
	}
	for _, evt := range parseEvents(t, frames) {
		if _, ok := evt.Data["namespace"]; ok {
			t.Fatalf("plain tool must not gain a namespace member: %+v", evt.Data)
		}
		if item, ok := evt.Data["item"].(map[string]any); ok {
			if _, has := item["namespace"]; has {
				t.Fatalf("plain tool item gained a namespace member: %+v", item)
			}
		}
	}
	if strings.Contains(strings.Join(func() []string {
		out := make([]string, 0, len(frames))
		for _, f := range frames {
			out = append(out, string(f))
		}
		return out
	}(), ""), "\"namespace\"") {
		t.Fatalf("plain tool stream leaked a namespace member")
	}
}
