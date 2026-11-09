package builtin

import (
	"context"
	"testing"
)

type fakeDispatcher struct {
	shutdown bool
}

func (f *fakeDispatcher) Call(context.Context, string, []byte) ([]byte, error) {
	return []byte(`{"ok":true}`), nil
}

func (f *fakeDispatcher) Shutdown() { f.shutdown = true }

func withEmptyRegistry(t *testing.T) {
	t.Helper()
	registry.Lock()
	saved := registry.entries
	registry.entries = map[string]registration{}
	registry.Unlock()
	t.Cleanup(func() {
		registry.Lock()
		registry.entries = saved
		registry.Unlock()
	})
}

func TestRegisterLookupOpen(t *testing.T) {
	withEmptyRegistry(t)
	var gotCall HostCall
	if err := Register("example-plugin", "1.2.3", func(call HostCall) Dispatcher {
		gotCall = call
		return &fakeDispatcher{}
	}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	version, ok := Lookup("example-plugin")
	if !ok || version != "1.2.3" {
		t.Fatalf("Lookup = %q,%v want 1.2.3,true", version, ok)
	}
	dispatcher, registered, err := Open("example-plugin", func(string, []byte) ([]byte, error) { return nil, nil })
	if err != nil || !registered || dispatcher == nil || gotCall == nil {
		t.Fatalf("Open = %v,%v,%v want dispatcher", dispatcher, registered, err)
	}
	if _, registered, err := Open("missing", func(string, []byte) ([]byte, error) { return nil, nil }); registered || err != nil {
		t.Fatalf("Open(missing) = registered=%v err=%v want false,nil", registered, err)
	}
}

func TestRegisterRejectsConflicts(t *testing.T) {
	withEmptyRegistry(t)
	factory := func(HostCall) Dispatcher { return &fakeDispatcher{} }
	if err := Register("p", "1.0.0", factory); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if err := Register("p", "1.0.0", factory); err != nil {
		t.Fatalf("idempotent Register: %v", err)
	}
	if err := Register("p", "2.0.0", factory); err == nil {
		t.Fatal("Register with a different version must fail")
	}
	if err := Register("", "1.0.0", factory); err == nil {
		t.Fatal("Register with an empty id must fail")
	}
	if err := Register("q", "", factory); err == nil {
		t.Fatal("Register with an empty version must fail")
	}
}

func TestOpenRequiresHostCall(t *testing.T) {
	withEmptyRegistry(t)
	if err := Register("p", "1.0.0", func(HostCall) Dispatcher { return &fakeDispatcher{} }); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if _, registered, err := Open("p", nil); !registered || err == nil {
		t.Fatalf("Open(nil host call) = registered=%v err=%v want an error", registered, err)
	}
}
