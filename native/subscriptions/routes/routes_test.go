// Tests for the private, provider-scoped subscription surface.
//
// They drive the real SDK pipeline: a gin engine, a real auth.Manager backed by
// fake core executors, and the process-wide model registry. That is the layer
// where the risk lives: two providers can register the exact same model ID, so
// only the `:provider` slug may decide which credential executes.
package routes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	coreexecutor "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/executor"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
)

const testIngressKey = "subscription-ingress-key"

// memoryStore is enough for auth.Manager.Register: the manager only persists,
// lists and deletes, and never requires a real file backend here.
type memoryStore struct {
	mu    sync.Mutex
	items map[string]*coreauth.Auth
}

func (s *memoryStore) List(context.Context) ([]*coreauth.Auth, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*coreauth.Auth, 0, len(s.items))
	for _, item := range s.items {
		out = append(out, item.Clone())
	}
	return out, nil
}

func (s *memoryStore) Save(_ context.Context, auth *coreauth.Auth) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.items == nil {
		s.items = make(map[string]*coreauth.Auth)
	}
	s.items[auth.ID] = auth.Clone()
	return auth.ID, nil
}

func (s *memoryStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.items, id)
	return nil
}

// fakeExecutor records which credentials were used and replays canned payloads.
// Payloads are already in the client-facing protocol: the SDK forwards executor
// output verbatim, so translation is an executor responsibility.
type fakeExecutor struct {
	provider string
	payload  []byte
	chunks   [][]byte

	calls atomic.Int32
	mu    sync.Mutex
	seen  []string
}

func (e *fakeExecutor) Identifier() string { return e.provider }

func (e *fakeExecutor) record(auth *coreauth.Auth, req coreexecutor.Request) {
	e.calls.Add(1)
	e.mu.Lock()
	defer e.mu.Unlock()
	e.seen = append(e.seen, req.Model)
}

func (e *fakeExecutor) Execute(_ context.Context, auth *coreauth.Auth, req coreexecutor.Request, _ coreexecutor.Options) (coreexecutor.Response, error) {
	e.record(auth, req)
	return coreexecutor.Response{Payload: bytes.Clone(e.payload), Headers: http.Header{}}, nil
}

func (e *fakeExecutor) ExecuteStream(_ context.Context, auth *coreauth.Auth, req coreexecutor.Request, _ coreexecutor.Options) (*coreexecutor.StreamResult, error) {
	e.record(auth, req)
	chunks := make(chan coreexecutor.StreamChunk, len(e.chunks))
	for _, chunk := range e.chunks {
		chunks <- coreexecutor.StreamChunk{Payload: bytes.Clone(chunk)}
	}
	close(chunks)
	return &coreexecutor.StreamResult{Headers: http.Header{}, Chunks: chunks}, nil
}

func (e *fakeExecutor) Refresh(_ context.Context, auth *coreauth.Auth) (*coreauth.Auth, error) {
	return auth.Clone(), nil
}

func (e *fakeExecutor) CountTokens(context.Context, *coreauth.Auth, coreexecutor.Request, coreexecutor.Options) (coreexecutor.Response, error) {
	return coreexecutor.Response{}, errors.New("count tokens is not exercised by these tests")
}

func (e *fakeExecutor) HttpRequest(context.Context, *coreauth.Auth, *http.Request) (*http.Response, error) {
	return nil, errors.New("raw http is not exercised by these tests")
}

func (e *fakeExecutor) modelCalls() []string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return append([]string(nil), e.seen...)
}

// testProvider describes one account source plus the model IDs it publishes.
type testProvider struct {
	provider string
	models   []string
}

type harness struct {
	engine    *gin.Engine
	manager   *coreauth.Manager
	executors map[string]*fakeExecutor
}

// newHarness wires the same auth manager and model registry the production
// gateway uses, then registers the subscription routes on a fresh gin engine.
func newHarness(t *testing.T, providers ...testProvider) *harness {
	t.Helper()
	gin.SetMode(gin.TestMode)

	manager := coreauth.NewManager(&memoryStore{}, &coreauth.RoundRobinSelector{}, coreauth.NoopHook{})
	registry := cliproxy.GlobalModelRegistry()
	h := &harness{manager: manager, executors: make(map[string]*fakeExecutor, len(providers))}

	for _, provider := range providers {
		executor := &fakeExecutor{provider: provider.provider}
		h.executors[provider.provider] = executor
		manager.RegisterExecutor(executor)

		authID := "account-" + provider.provider
		if _, err := manager.Register(context.Background(), &coreauth.Auth{ID: authID, Provider: provider.provider}); err != nil {
			t.Fatalf("register auth for %s: %v", provider.provider, err)
		}

		infos := make([]*cliproxy.ModelInfo, 0, len(provider.models))
		for _, id := range provider.models {
			infos = append(infos, &cliproxy.ModelInfo{ID: id, Object: "model", OwnedBy: provider.provider})
		}
		registry.RegisterClient(authID, provider.provider, infos)
		clientID := authID
		t.Cleanup(func() { registry.UnregisterClient(clientID) })
	}

	sdkCfg := &config.SDKConfig{}
	base := handlers.NewBaseAPIHandlers(sdkCfg, manager)
	cfg := &config.Config{SDKConfig: *sdkCfg}
	cfg.APIKeys = []string{testIngressKey}

	h.engine = gin.New()
	Register(h.engine, base, cfg)
	return h
}

func (h *harness) do(t *testing.T, method, target, key string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	switch typed := body.(type) {
	case nil:
		reader = bytes.NewReader(nil)
	case []byte:
		reader = bytes.NewReader(typed)
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			t.Fatalf("encode request body: %v", err)
		}
		reader = bytes.NewReader(encoded)
	}
	req := httptest.NewRequest(method, target, reader)
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	rec := httptest.NewRecorder()
	h.engine.ServeHTTP(rec, req)
	return rec
}

func decodeCatalog(t *testing.T, rec *httptest.ResponseRecorder) []string {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("models status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode models: %v (body %s)", err, rec.Body.String())
	}
	ids := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		ids = append(ids, item.ID)
	}
	sort.Strings(ids)
	return ids
}

// Every subscription route is an internal surface: without the projected
// ingress key nothing may reach an account or the catalog.
func TestSubscriptionRoutesRejectMissingIngressKey(t *testing.T) {
	h := newHarness(t, testProvider{provider: "commandcode", models: []string{"commandcode/only"}})

	for _, probe := range []struct{ method, target string }{
		{http.MethodGet, "/subscriptions/commandcode/v1/models"},
		{http.MethodPost, "/subscriptions/commandcode/v1/chat/completions"},
		{http.MethodPost, "/subscriptions/commandcode/v1/responses"},
		{http.MethodPost, "/subscriptions/commandcode/v1/messages"},
		{http.MethodGet, "/_litellm/subscription-catalog"},
	} {
		rec := h.do(t, probe.method, probe.target, "", map[string]any{"model": "commandcode/only"})
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s %s without credentials = %d, want %d", probe.method, probe.target, rec.Code, http.StatusUnauthorized)
		}
	}

	wrong := h.do(t, http.MethodPost, "/subscriptions/commandcode/v1/chat/completions", "not-the-key", map[string]any{"model": "commandcode/only"})
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong ingress key = %d, want %d", wrong.Code, http.StatusUnauthorized)
	}
	if executor := h.executors["commandcode"]; executor.calls.Load() != 0 {
		t.Fatalf("rejected requests reached the executor %d times", executor.calls.Load())
	}
}

// The gateway authenticates OpenAI-shaped calls with a bearer token and the
// native Anthropic path with `x-api-key`; both must be accepted, and neither
// credential may be echoed back.
func TestSubscriptionRoutesAcceptBearerAndAPIKeyHeader(t *testing.T) {
	h := newHarness(t, testProvider{provider: "commandcode", models: []string{"commandcode/only"}})
	h.executors["commandcode"].payload = []byte(`{"id":"chat-ok","object":"chat.completion","choices":[]}`)

	bearer := h.do(t, http.MethodPost, "/subscriptions/commandcode/v1/chat/completions", testIngressKey,
		map[string]any{"model": "commandcode/only", "messages": []map[string]any{{"role": "user", "content": "hi"}}})
	if bearer.Code != http.StatusOK {
		t.Fatalf("bearer request = %d, body = %s", bearer.Code, bearer.Body.String())
	}

	req := httptest.NewRequest(http.MethodPost, "/subscriptions/commandcode/v1/chat/completions",
		strings.NewReader(`{"model":"commandcode/only","messages":[{"role":"user","content":"hi"}]}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", testIngressKey)
	rec := httptest.NewRecorder()
	h.engine.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("x-api-key request = %d, body = %s", rec.Code, rec.Body.String())
	}

	for _, got := range []*httptest.ResponseRecorder{bearer, rec} {
		if strings.Contains(got.Body.String(), testIngressKey) {
			t.Fatalf("response leaked the ingress key: %s", got.Body.String())
		}
	}
}

func TestSubscriptionRoutesRejectUnknownProviderSlug(t *testing.T) {
	h := newHarness(t, testProvider{provider: "commandcode", models: []string{"commandcode/only"}})

	rec := h.do(t, http.MethodPost, "/subscriptions/codex-compat/v1/chat/completions", testIngressKey,
		map[string]any{"model": "commandcode/only"})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown provider slug = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

// The catalog is provider-scoped and keeps registry IDs verbatim, so a plugin
// namespace such as `commandcode/` survives the round trip.
func TestProviderScopedModelsCatalog(t *testing.T) {
	h := newHarness(t,
		testProvider{provider: "commandcode", models: []string{"commandcode/shared", "commandcode/only"}},
		testProvider{provider: "opencode-go", models: []string{"opencode-go/shared"}},
	)

	commandcode := decodeCatalog(t, h.do(t, http.MethodGet, "/subscriptions/commandcode/v1/models", testIngressKey, nil))
	if want := []string{"commandcode/only", "commandcode/shared"}; !equalStrings(commandcode, want) {
		t.Fatalf("commandcode models = %v, want %v", commandcode, want)
	}

	opencode := decodeCatalog(t, h.do(t, http.MethodGet, "/subscriptions/opencode-go/v1/models", testIngressKey, nil))
	if want := []string{"opencode-go/shared"}; !equalStrings(opencode, want) {
		t.Fatalf("opencode-go models = %v, want %v", opencode, want)
	}
}

// Both providers publish the exact same model ID. Resolution by model alone
// would be ambiguous, so only the `:provider` slug may choose the credential.
func TestSourceBindingNeverCrossesProviders(t *testing.T) {
	const shared = "shared-model"
	h := newHarness(t,
		testProvider{provider: "commandcode", models: []string{shared}},
		testProvider{provider: "opencode-go", models: []string{shared}},
	)
	for provider, executor := range h.executors {
		executor.payload = []byte(`{"id":"` + provider + `","object":"chat.completion","choices":[]}`)
	}

	body := map[string]any{"model": shared, "messages": []map[string]any{{"role": "user", "content": "hi"}}}

	first := h.do(t, http.MethodPost, "/subscriptions/commandcode/v1/chat/completions", testIngressKey, body)
	if first.Code != http.StatusOK {
		t.Fatalf("commandcode request = %d, body = %s", first.Code, first.Body.String())
	}
	if !strings.Contains(first.Body.String(), `"id":"commandcode"`) {
		t.Fatalf("commandcode response came from another executor: %s", first.Body.String())
	}
	if got := h.executors["commandcode"].calls.Load(); got != 1 {
		t.Fatalf("commandcode executor calls = %d, want 1", got)
	}
	if got := h.executors["opencode-go"].calls.Load(); got != 0 {
		t.Fatalf("opencode-go executor was reached by a commandcode request (%d calls)", got)
	}
	if got := h.executors["commandcode"].modelCalls(); len(got) != 1 || got[0] != shared {
		t.Fatalf("commandcode executor saw models %v, want [%s]", got, shared)
	}

	second := h.do(t, http.MethodPost, "/subscriptions/opencode-go/v1/chat/completions", testIngressKey, body)
	if second.Code != http.StatusOK {
		t.Fatalf("opencode-go request = %d, body = %s", second.Code, second.Body.String())
	}
	if !strings.Contains(second.Body.String(), `"id":"opencode-go"`) {
		t.Fatalf("opencode-go response came from another executor: %s", second.Body.String())
	}
	if got := h.executors["opencode-go"].calls.Load(); got != 1 {
		t.Fatalf("opencode-go executor calls = %d, want 1", got)
	}
	if got := h.executors["commandcode"].calls.Load(); got != 1 {
		t.Fatalf("commandcode executor was reached again by an opencode-go request (%d calls)", got)
	}
}

// A model the slug's provider never published must not be forwarded to that
// provider's account just because some other provider serves it.
func TestSourceBindingRejectsUnboundModel(t *testing.T) {
	h := newHarness(t, testProvider{provider: "commandcode", models: []string{"commandcode/only"}})
	h.executors["commandcode"].payload = []byte(`{"choices":[]}`)

	rec := h.do(t, http.MethodPost, "/subscriptions/commandcode/v1/chat/completions", testIngressKey,
		map[string]any{"model": "claude/not-ours", "messages": []map[string]any{{"role": "user", "content": "hi"}}})
	if rec.Code == http.StatusOK {
		t.Fatalf("unbound model was accepted: %s", rec.Body.String())
	}
	if got := h.executors["commandcode"].calls.Load(); got != 0 {
		t.Fatalf("unbound model reached the executor %d times", got)
	}
}

// Chat completions must keep the upstream SSE contract: one `data:` frame per
// translated chunk plus the `[DONE]` terminator.
func TestChatCompletionsStreamTerminates(t *testing.T) {
	h := newHarness(t, testProvider{provider: "commandcode", models: []string{"commandcode/stream"}})
	h.executors["commandcode"].chunks = [][]byte{
		[]byte(`{"id":"chat-1","object":"chat.completion.chunk","model":"commandcode/stream","choices":[{"index":0,"delta":{"role":"assistant","content":"hi"},"finish_reason":null}]}`),
		[]byte(`{"id":"chat-1","object":"chat.completion.chunk","model":"commandcode/stream","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`),
	}

	rec := h.do(t, http.MethodPost, "/subscriptions/commandcode/v1/chat/completions", testIngressKey,
		map[string]any{"model": "commandcode/stream", "stream": true, "messages": []map[string]any{{"role": "user", "content": "hi"}}})

	if rec.Code != http.StatusOK {
		t.Fatalf("stream status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/event-stream") {
		t.Fatalf("content type = %q, want text/event-stream", got)
	}
	body := rec.Body.String()
	if !strings.Contains(body, `data: {"id":"chat-1"`) {
		t.Fatalf("missing data frame: %s", body)
	}
	if !strings.HasSuffix(body, "data: [DONE]\n\n") {
		t.Fatalf("stream did not terminate with [DONE]: %q", body)
	}
	if !strings.Contains(body, `"finish_reason":"stop"`) {
		t.Fatalf("stream dropped the terminal chunk: %s", body)
	}
}

// The Responses surface must emit its terminal event so agent clients can stop
// reading; a bare channel close is reported as a truncated stream.
func TestResponsesStreamTerminates(t *testing.T) {
	h := newHarness(t, testProvider{provider: "commandcode", models: []string{"commandcode/resp"}})
	h.executors["commandcode"].chunks = [][]byte{
		[]byte("event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_1\"}}\n\n"),
		[]byte("event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}\n\n"),
		[]byte("event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"status\":\"completed\"}}\n\n"),
	}

	rec := h.do(t, http.MethodPost, "/subscriptions/commandcode/v1/responses", testIngressKey,
		map[string]any{"model": "commandcode/resp", "stream": true, "input": "hi"})

	if rec.Code != http.StatusOK {
		t.Fatalf("responses status = %d, body = %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "event: response.created") {
		t.Fatalf("missing response.created frame: %s", body)
	}
	if !strings.Contains(body, "event: response.completed") {
		t.Fatalf("responses stream did not terminate: %s", body)
	}
	if strings.Contains(body, "closed before a terminal event") {
		t.Fatalf("responses stream was reported truncated: %s", body)
	}
}

// The catalog exposes every owner of an ID, including plugin sources, so the
// gateway can bind legacy deployments without guessing from vendor names.
func TestSubscriptionCatalogReportsEveryOwner(t *testing.T) {
	const shared = "shared-catalog-model"
	h := newHarness(t,
		testProvider{provider: "commandcode", models: []string{shared}},
		testProvider{provider: "opencode-go", models: []string{shared}},
	)

	rec := h.do(t, http.MethodGet, "/_litellm/subscription-catalog", testIngressKey, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("catalog status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Data []struct {
			ID        string   `json:"id"`
			Providers []string `json:"providers"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	for _, item := range payload.Data {
		if item.ID != shared {
			continue
		}
		owners := append([]string(nil), item.Providers...)
		sort.Strings(owners)
		if !equalStrings(owners, []string{"commandcode", "opencode-go"}) {
			t.Fatalf("catalog owners = %v, want both providers", owners)
		}
		return
	}
	t.Fatalf("catalog did not contain %q: %s", shared, rec.Body.String())
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
