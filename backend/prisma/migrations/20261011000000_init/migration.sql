-- CreateTable
CREATE TABLE "app_meta" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_meta_pkey" PRIMARY KEY ("key")
);

-- Technical baseline marker (no business data)
INSERT INTO "app_meta" ("key", "value") VALUES ('schema_baseline', 'b1.1');
