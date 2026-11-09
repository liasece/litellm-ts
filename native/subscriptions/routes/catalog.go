package routes

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
)

// This catalog includes every registered source, including third-party plugins.
// Account-bound SDK operations use this index to reject ambiguous native model IDs.
func registerCatalog(engine *gin.Engine, _ *handlers.BaseAPIHandler, cfg *config.Config) {
	engine.GET("/_litellm/subscription-catalog", func(c *gin.Context) {
		if !authorized(c, cfg) {
			return
		}
		registry := cliproxy.GlobalModelRegistry()
		sources, ok := registry.(interface{ GetModelProviders(string) []string })
		if !ok {
			c.AbortWithStatus(http.StatusServiceUnavailable)
			return
		}
		type model struct {
			ID        string   `json:"id"`
			Providers []string `json:"providers"`
		}
		models := make([]model, 0)
		for _, item := range registry.GetAvailableModels("openai") {
			if id, ok := item["id"].(string); ok && id != "" {
				models = append(models, model{ID: id, Providers: sources.GetModelProviders(id)})
			}
		}
		c.JSON(http.StatusOK, gin.H{"data": models})
	})
}
