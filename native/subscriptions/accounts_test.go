//go:build builtinhost

package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/sdk/auth"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

func TestArchivedAccountIsDisabledUntilRestored(t *testing.T) {
	dir := t.TempDir()
	trash := filepath.Join(dir, ".trash")
	if err := os.Mkdir(trash, 0700); err != nil {
		t.Fatal(err)
	}
	store := auth.NewFileTokenStore()
	store.SetBaseDir(dir)
	name := "fixture-codex.json"
	archived := filepath.Join(trash, "123-"+name)
	payload := []byte(`{"type":"codex","email":"fixture@example.test","disabled":false}`)
	if err := os.WriteFile(archived, payload, 0600); err != nil {
		t.Fatal(err)
	}
	listed := func() *coreauth.Auth {
		t.Helper()
		records, err := store.List(context.Background())
		if err != nil || len(records) != 1 {
			t.Fatalf("expected one account, got %d (error %v)", len(records), err)
		}
		return records[0]
	}
	if a := listed(); !a.Disabled || a.Status != coreauth.StatusDisabled {
		t.Fatal("archived account is eligible")
	}
	stored, err := os.ReadFile(archived)
	if err != nil || string(stored) != string(payload) {
		t.Fatal("listing the archive changed the saved credentials or status")
	}
	if err := os.Rename(archived, filepath.Join(dir, name)); err != nil {
		t.Fatal(err)
	}
	if a := listed(); a.Disabled || a.Status == coreauth.StatusDisabled {
		t.Fatal("restored account was not eligible")
	}
}
