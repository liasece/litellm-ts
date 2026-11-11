-- A completed operation owns metadata and references existing immutable image bytes.
CREATE TABLE "LiteLLM_ImageCompletion" (
    "id" text PRIMARY KEY,
    "scope" text NOT NULL,
    "request_hash" text NOT NULL,
    "action" text NOT NULL CHECK ("action" IN ('create', 'edit')),
    "tool_call_id" text NOT NULL,
    "status" text NOT NULL CHECK ("status" IN ('running', 'completed', 'unknown')),
    "assets" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "LiteLLM_ImageCompletionAnchor" (
    "scope" text NOT NULL,
    "anchor" text NOT NULL,
    "reply_id" text NOT NULL,
    "operation_id" text NOT NULL REFERENCES "LiteLLM_ImageCompletion" ("id") ON DELETE CASCADE,
    PRIMARY KEY ("scope", "anchor", "reply_id", "operation_id")
);
