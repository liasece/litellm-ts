ALTER TABLE "LiteLLM_ActiveRequests" ADD COLUMN "proxy_server_request" jsonb DEFAULT '{}'::jsonb NOT NULL;
