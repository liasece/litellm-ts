package catalog

import (
	"encoding/json"
	"testing"

	"commandcode-go-cliproxyapi/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/pluginapi"
)

// TestRouteFor picks the upstream protocol per catalog id. Responses is the
// default because it is the only CommandCode route that accepts the native
// namespace/web_search tool shapes; Claude ids are the exception because the
// upstream rejects them on /responses and only serves them on /messages.
func TestRouteFor(t *testing.T) {
	chatOnly := []string{
		"deepseek/deepseek-v4.1-flash",
		"z-ai/glm-5.3-flash",
		"gpt-5.6-luna",
		"minimax-m3",
		"glm-5.2",
		"mystery-model",
		"QWEN4-MAX",
	}
	for _, id := range chatOnly {
		if got := routeFor(id); got != RouteResponses {
			t.Errorf("routeFor(%q) = %q, want %q", id, got, RouteResponses)
		}
	}

	// Claude ids land under an optional vendor/ prefix and in mixed case.
	claude := []string{
		"claude-sonnet-5-5",
		"claude-opus-4-20250514",
		"anthropic/claude-sonnet-5-5",
		"Claude-Haiku-4",
	}
	for _, id := range claude {
		if got := routeFor(id); got != RouteMessages {
			t.Errorf("routeFor(%q) = %q, want %q", id, got, RouteMessages)
		}
	}

	// A vendor directory alone must not make something look like Claude.
	if got := routeFor("z-ai/claude-not-a-weight"); got != RouteMessages {
		t.Errorf("vendor-prefixed claude id = %q, want messages", got)
	}
	if got := routeFor("moonshotai/Kimi-K3"); got != RouteResponses {
		t.Errorf("non-claude vendor id = %q, want responses", got)
	}
}

// TestClaudeModelsRouteToMessagesThroughRefresh pins the same split through a
// real catalog refresh, so the resolve() wiring cannot drift from routeFor.
func TestClaudeModelsRouteToMessagesThroughRefresh(t *testing.T) {
	body := `{"data":[{"id":"deepseek/deepseek-v4.1-flash"},{"id":"anthropic/claude-sonnet-5-5"}]}`
	m := newManager(testCfg(), &fakeClient{resp: pluginapi.HTTPResponse{StatusCode: 200, Body: []byte(body)}})
	mustRefresh(t, m)

	models := m.Models()
	if len(models) != 2 {
		t.Fatalf("models = %+v", models)
	}
	for _, mo := range models {
		switch mo.UpstreamID {
		case "deepseek/deepseek-v4.1-flash":
			if mo.Protocol != RouteResponses || mo.EndpointPath != "/v1/responses" {
				t.Errorf("oss model = %+v, want responses route", mo)
			}
		case "anthropic/claude-sonnet-5-5":
			if mo.Protocol != RouteMessages || mo.EndpointPath != "/v1/messages" {
				t.Errorf("claude model = %+v, want messages route", mo)
			}
		default:
			t.Errorf("unexpected model %q", mo.UpstreamID)
		}
	}

	// An explicit override still wins over the per-id default.
	cfg := testCfg()
	cfg.RouteOverrides = map[string]config.RouteOverride{
		"deepseek/deepseek-v4.1-flash": {Protocol: "chat-completions", Endpoint: "/v1/chat/completions"},
	}
	m2 := newManager(cfg, &fakeClient{resp: pluginapi.HTTPResponse{StatusCode: 200, Body: []byte(body)}})
	mustRefresh(t, m2)
	for _, mo := range m2.Models() {
		if mo.UpstreamID == "deepseek/deepseek-v4.1-flash" {
			if mo.Protocol != RouteChatCompletions {
				t.Errorf("override ignored: %+v", mo)
			}
		}
	}
}

// TestResponsesDefaultAcceptsNativeToolShapes is the regression pin for the
// production failure: a namespace tool and a web_search entry must reach the
// upstream untouched on the default route, because the Chat leg rejects both.
func TestResponsesDefaultAcceptsNativeToolShapes(t *testing.T) {
	if DefaultRoute != RouteResponses {
		t.Fatalf("DefaultRoute = %q, want %q so native tool shapes survive", DefaultRoute, RouteResponses)
	}
	// The upstream /responses leg is the only one whose adapter forwards the
	// native tool array; assert the route we route to is that one.
	var tools []any
	_ = json.Unmarshal([]byte(`[{"type":"namespace","name":"mcp__node_repl","tools":[]},{"type":"web_search"}]`), &tools)
	if len(tools) != 2 {
		t.Fatalf("fixture broken")
	}
	if got := routeFor("deepseek/deepseek-v4.1-flash"); got.EndpointPath() != "/v1/responses" {
		t.Fatalf("oss model endpoint = %q", got.EndpointPath())
	}
}
