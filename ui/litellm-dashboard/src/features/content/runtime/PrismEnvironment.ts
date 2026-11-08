// Configure Prism before its core is evaluated: Vue alone owns rendered nodes.
const environment = globalThis as typeof globalThis & { Prism?: { manual?: boolean; disableWorkerMessageHandler?: boolean } };
environment.Prism ??= {};
environment.Prism.manual = true;
environment.Prism.disableWorkerMessageHandler = true;
