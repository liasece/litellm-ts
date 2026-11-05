package adapters

import (
	"strings"
	"testing"

	"commandcode-go-cliproxyapi/internal/adapter/responses"
)

// reasoningResponsesFrames is a Responses-shaped upstream stream: the
// thinking text arrives as reasoning_summary_text deltas (the shape
// CommandCode's native /responses endpoint uses), then answer text, then the
// terminal event with usage.
func reasoningResponsesFrames() []string {
	return []string{
		"event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_1\",\"model\":\"m\",\"status\":\"in_progress\"}}\n\n",
		"event: response.reasoning_summary_text.delta\ndata: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"We\"}\n\n",
		"event: response.reasoning_summary_text.delta\ndata: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\" need\"}\n\n",
		"event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"2\"}\n\n",
		"event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"status\":\"completed\",\"usage\":{\"input_tokens\":3,\"output_tokens\":4}}}\n\n",
	}
}

func feedReasoningFrames(t *testing.T, conv feeder) string {
	t.Helper()
	var out []string
	for _, frame := range reasoningResponsesFrames() {
		events, _, eErr := conv.Feed([]byte(frame))
		if eErr != nil {
			t.Fatalf("feed: %v", eErr)
		}
		for _, event := range events {
			out = append(out, string(event))
		}
	}
	return strings.Join(out, "")
}

// A Responses-upstream stream served to a Chat Completions client must keep
// the thinking phase in reasoning_content. Dropping it erased the model's
// whole reasoning from chat clients (and from litellm's chat hop).
func TestResponsesUpstreamReasoningReachesChatClient(t *testing.T) {
	joined := feedReasoningFrames(t, responses.NewStreamConverterWithTools("openai", nil))
	for _, want := range []string{
		"\"reasoning_content\":\"We\"",
		"\"reasoning_content\":\" need\"",
		"\"content\":\"2\"",
		"\"finish_reason\":\"stop\"",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("chat stream missing %q:\n%s", want, joined)
		}
	}
}

// The same stream served to an Anthropic Messages client must become an
// extended-thinking block that closes before the text block opens.
func TestResponsesUpstreamReasoningReachesClaudeClient(t *testing.T) {
	joined := feedReasoningFrames(t, responses.NewStreamConverterWithTools("claude", nil))
	for _, want := range []string{
		"\"type\":\"thinking\"",
		"\"thinking_delta\"",
		"\"thinking\":\"We\"",
		"\"thinking\":\" need\"",
		"\"text\":\"2\"",
		"message_stop",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("claude stream missing %q:\n%s", want, joined)
		}
	}
	thinkingStop := strings.Index(joined, "\"content_block_stop\"")
	textStart := strings.Index(joined, "\"type\":\"text\"")
	if thinkingStop < 0 || textStart < 0 || thinkingStop > textStart {
		t.Fatalf("thinking block must stop before the text block starts:\n%s", joined)
	}
}
