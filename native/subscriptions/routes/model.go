package routes

import (
	"context"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

type turnSourceKey struct{}

// The SDK registry uses each plugin's configured namespace for account lookup.
// The provider-native name is what belongs in deployment configuration and HTTP bodies.
func upstreamModel(source, registered, native string) string {
	if source == "commandcode" || source == "opencode-go" {
		if native != "" {
			return native
		}
		return strings.TrimPrefix(registered, source+"/")
	}
	return registered
}

func registeredModel(source, upstream string) string {
	if source == "commandcode" || source == "opencode-go" {
		for _, model := range cliproxy.GlobalModelRegistry().GetAvailableModelsByProvider(source) {
			if model != nil && upstreamModel(source, model.ID, model.Name) == upstream {
				return model.ID
			}
		}
	}
	return upstream
}

// Each websocket turn has its own authorized provider. A continuation without a model
// inherits the preceding turn. The private field is removed before SDK recording and forwarding.
func bindWebsocketTurns() func(context.Context, []byte) (context.Context, []byte) {
	var lastSource string
	return func(ctx context.Context, frame []byte) (context.Context, []byte) {
		const key = "_litellm_subscription"
		if hint := gjson.GetBytes(frame, key); hint.Exists() {
			lastSource = accountSource(hint.String())
			frame, _ = sjson.DeleteBytes(frame, key)
		}
		return context.WithValue(ctx, turnSourceKey{}, lastSource), frame
	}
}
