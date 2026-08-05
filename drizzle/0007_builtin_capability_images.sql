CREATE TABLE IF NOT EXISTS "LiteLLM_BuiltinCapabilityImages" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"media_type" text NOT NULL,
	"base64_data" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL
);
