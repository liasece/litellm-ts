package routes

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/access"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers/claude"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers/gemini"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers/openai"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/pluginapi"
)

func accountSource(slug string) string {
	switch slug {
	case "commandcode", "opencode-go":
		return slug
	case "codex-subscription", "claude-subscription", "kimi-subscription", "antigravity-subscription", "xai-subscription":
		return strings.TrimSuffix(slug, "-subscription")
	}
	return ""
}

// RequireSource prevents callers of the private worker from bypassing the
// selected subscription through the SDK's default inference routes.
func RequireSource(c *gin.Context) {
	switch c.FullPath() {
	case "/v1/chat/completions", "/v1/completions", "/v1/messages", "/v1/messages/count_tokens",
		"/v1/responses", "/v1/responses/compact", "/backend-api/codex/responses", "/backend-api/codex/responses/compact",
		"/v1/images/generations", "/v1/images/edits", "/v1beta/interactions", "/v1beta/models/*action":
		c.AbortWithStatus(http.StatusNotFound)
	default:
		c.Next()
	}
}

func authorized(c *gin.Context, cfg *config.Config) bool {
	key := c.GetHeader("X-Api-Key")
	if h := c.GetHeader("Authorization"); h != "" {
		scheme, value, _ := strings.Cut(h, " ")
		if !strings.EqualFold(scheme, "Bearer") {
			c.AbortWithStatus(http.StatusUnauthorized)
			return false
		}
		key = value
	}
	if key == "" || len(cfg.APIKeys) != 1 || subtle.ConstantTimeCompare([]byte(key), []byte(cfg.APIKeys[0])) != 1 {
		c.AbortWithStatus(http.StatusUnauthorized)
		return false
	}
	c.Set("userApiKey", key)
	return true
}

type subscriptionRouter struct {
	source string
	compat handlers.PluginModelRouterHost
}

func (subscriptionRouter) HasModelRouters() bool { return true }

func (r subscriptionRouter) RouteModel(ctx context.Context, req pluginapi.ModelRouteRequest) (pluginapi.ModelRouteResponse, bool) {
	source, model := r.source, req.RequestedModel
	if source == "" {
		source, _ = ctx.Value(turnSourceKey{}).(string)
		if source == "" {
			if r.compat != nil {
				return r.compat.RouteModel(ctx, req)
			}
			return pluginapi.ModelRouteResponse{}, false
		}
	}
	return pluginapi.ModelRouteResponse{Handled: true, TargetKind: pluginapi.ModelRouteTargetProvider, Target: source, TargetModel: registeredModel(source, model)}, true
}

// Register adapts LiteLLM's private provider-qualified routes to the SDK's
// original HTTP handlers. Session IDs, native tools, streaming frames and
// terminal errors therefore follow the upstream protocol implementation.
func Register(engine *gin.Engine, base *handlers.BaseAPIHandler, cfg *config.Config, accessManagers ...*access.Manager) {
	var accessManager *access.Manager
	if len(accessManagers) != 0 {
		accessManager = accessManagers[0]
	}
	interceptors := base.PluginHost
	compat, _ := interceptors.(handlers.PluginModelRouterHost)
	type sourceKey struct{}
	inner := gin.New()
	inner.RedirectTrailingSlash = false
	inner.Use(func(c *gin.Context) {
		if !authorized(c, cfg) {
			return
		}
		c.Next()
	})
	dispatch := func(call func(*handlers.BaseAPIHandler, *gin.Context)) gin.HandlerFunc {
		return func(c *gin.Context) {
			source, _ := c.Request.Context().Value(sourceKey{}).(string)
			b := handlers.NewBaseAPIHandlers(base.CurrentConfig(), base.AuthManager)
			b.SetPluginHost(interceptors)
			b.SetModelRouterHost(subscriptionRouter{source: source, compat: compat})
			call(b, c)
		}
	}
	inner.GET("/v1/models", func(c *gin.Context) {
		source, _ := c.Request.Context().Value(sourceKey{}).(string)
		models := cliproxy.GlobalModelRegistry().GetAvailableModelsByProvider(source)
		type item struct {
			ID string `json:"id"`
		}
		items := make([]item, 0, len(models))
		for _, model := range models {
			if model != nil {
				items = append(items, item{ID: upstreamModel(source, model.ID, model.Name)})
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": items})
	})
	inner.POST("/v1/chat/completions", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { openai.NewOpenAIAPIHandler(b).ChatCompletions(c) }))
	inner.POST("/v1/messages", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { claude.NewClaudeCodeAPIHandler(b).ClaudeMessages(c) }))
	inner.POST("/v1/responses", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { openai.NewOpenAIResponsesAPIHandler(b).Responses(c) }))
	inner.POST("/v1/images/generations", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { openai.NewOpenAIAPIHandler(b).ImagesGenerations(c) }))
	inner.POST("/v1/images/edits", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { openai.NewOpenAIAPIHandler(b).ImagesEdits(c) }))
	inner.POST("/v1/responses/compact", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { openai.NewOpenAIResponsesAPIHandler(b).Compact(c) }))
	inner.POST("/v1/messages/count_tokens", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) {
		claude.NewClaudeCodeAPIHandler(b).ClaudeCountTokens(c)
	}))
	inner.POST("/v1/completions", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { openai.NewOpenAIAPIHandler(b).Completions(c) }))
	inner.POST("/v1beta/interactions", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { gemini.NewGeminiAPIHandler(b).Interactions(c) }))
	inner.POST("/v1beta/models/*action", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { gemini.NewGeminiAPIHandler(b).GeminiHandler(c) }))
	inner.GET("/v1beta/models/*action", dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) { gemini.NewGeminiAPIHandler(b).GeminiGetHandler(c) }))
	ws := dispatch(func(b *handlers.BaseAPIHandler, c *gin.Context) {
		h := openai.NewOpenAIResponsesAPIHandler(b)
		h.AccessManager = accessManager
		c.Set("litellm.subscriptionTurn", bindWebsocketTurns())
		h.ResponsesWebsocket(c)
	})
	inner.GET("/v1/responses", ws)
	inner.GET("/backend-api/codex/responses", ws)
	// Dispatch in-process under the real public protocol path. SDK executors
	// use that path (including gin.FullPath) to distinguish operations.
	serve := func(c *gin.Context, source, path string) {
		r := c.Request.Clone(context.WithValue(c.Request.Context(), sourceKey{}, source))
		r.URL.Path, r.URL.RawPath = path, ""
		r.RequestURI = r.URL.RequestURI()
		inner.ServeHTTP(c.Writer, r)
	}
	handle := func(c *gin.Context) {
		source := accountSource(c.Param("provider"))
		if source == "" {
			c.AbortWithStatus(http.StatusNotFound)
			return
		}
		serve(c, source, c.Param("path"))
	}
	engine.POST("/subscriptions/:provider/*path", handle)
	engine.GET("/subscriptions/:provider/*path", handle)
	engine.GET("/_litellm/ws/v1/responses", func(c *gin.Context) { serve(c, "", "/v1/responses") })
	engine.GET("/_litellm/ws/backend-api/codex/responses", func(c *gin.Context) { serve(c, "", "/backend-api/codex/responses") })
	registerCatalog(engine, base, cfg)
}
