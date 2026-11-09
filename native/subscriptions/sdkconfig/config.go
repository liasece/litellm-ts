// Package litellmconfig applies the CLI's startup settings to an embedded SDK
// service. Both the management API and the subscription routes see this state.
package litellmconfig

import (
	"runtime/debug"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/buildinfo"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/logging"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/redisqueue"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
)

func Apply(cfg *config.Config) error {
	logging.SetupBaseLogger()
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, dep := range info.Deps {
			if dep.Path == "github.com/router-for-me/CLIProxyAPI/v8" {
				buildinfo.Version = dep.Version
				break
			}
		}
	}
	redisqueue.SetUsageStatisticsEnabled(cfg.UsageStatisticsEnabled)
	redisqueue.SetRetentionSeconds(cfg.RedisUsageQueueRetentionSeconds)
	util.SetLogLevel(cfg)
	return logging.ConfigureLogOutput(cfg)
}
