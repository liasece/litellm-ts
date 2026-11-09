// The gateway owns this executable and the account directory it opens. Both
// subscription routes and the compatibility API use the same token store and
// scheduler, including when an administrator switches runtime versions.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/gin-gonic/gin"
	"github.com/jtllab/litellm-ts/subscriptions/routes"
	"github.com/router-for-me/CLIProxyAPI/v8/contrib/litellmconfig"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/access"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/api/handlers"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/auth"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy"
	"github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
	_ "github.com/router-for-me/CLIProxyAPI/v8/sdk/translator/builtin"
)

func main() {
	configPath := flag.String("config", "", "gateway-projected subscription configuration")
	noBrowser := flag.Bool("no-browser", false, "print the login URL")
	login := ""
	for _, provider := range []string{"codex", "codex-device", "claude", "kimi", "antigravity", "xai"} {
		flag.BoolFunc(provider+"-login", "authorize a "+provider+" subscription", func(string) error {
			if login != "" {
				return errors.New("select one login method")
			}
			login = provider
			return nil
		})
	}
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, *configPath, login, *noBrowser); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, configPath, login string, noBrowser bool) error {
	cfg, err := config.LoadConfig(configPath)
	if err != nil {
		return errors.New("could not read the subscription configuration")
	}
	if cfg.Host != "127.0.0.1" || len(cfg.APIKeys) == 0 || cfg.AuthDir == "" {
		return errors.New("subscription runtime requires a loopback listener, an ingress key and an account directory")
	}
	if err := litellmconfig.Apply(cfg); err != nil {
		return errors.New("could not configure the subscription log")
	}
	store := auth.NewFileTokenStore()
	store.SetBaseDir(cfg.AuthDir)
	auth.RegisterTokenStore(store)
	if login != "" {
		options := &auth.LoginOptions{NoBrowser: noBrowser}
		stdin := bufio.NewReader(os.Stdin)
		options.Prompt = func(prompt string) (string, error) {
			fmt.Print(prompt)
			line, err := stdin.ReadString('\n')
			return strings.TrimSpace(line), err
		}
		if login == "codex-device" {
			login = "codex"
			options.Metadata = map[string]string{"codex_login_mode": "device"}
		}
		accounts := auth.NewManager(store, auth.NewCodexAuthenticator(), auth.NewClaudeAuthenticator(),
			auth.NewKimiAuthenticator(), auth.NewAntigravityAuthenticator(), auth.NewXAIAuthenticator())
		if _, _, err := accounts.Login(ctx, login, cfg, options); err != nil {
			return fmt.Errorf("%s subscription login failed", login)
		}
		fmt.Println("Subscription account saved")
		return nil
	}
	auth.StartAntigravityVersionUpdater(ctx)
	accessManager := access.NewManager()
	host, err := cliproxy.NewBuilder().WithConfig(cfg).WithConfigPath(configPath).WithRequestAccessManager(accessManager).
		WithServerOptions(api.WithMiddleware(routes.RequireSource), api.WithRouterConfigurator(func(engine *gin.Engine, base *handlers.BaseAPIHandler, current *config.Config) {
			routes.Register(engine, base, current, accessManager)
		})).Build()
	if err != nil {
		return err
	}
	return host.Run(ctx)
}
