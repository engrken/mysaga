DO $$ BEGIN
  CREATE TYPE "StorageProvider" AS ENUM ('GOOGLE_DRIVE', 'CLOUDFLARE_R2');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ActivitySubmission"
  ADD COLUMN IF NOT EXISTS "storageProvider" "StorageProvider",
  ADD COLUMN IF NOT EXISTS "fileKey" TEXT,
  ADD COLUMN IF NOT EXISTS "fileUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "fileName" TEXT,
  ADD COLUMN IF NOT EXISTS "fileSize" INTEGER,
  ADD COLUMN IF NOT EXISTS "mimeType" TEXT;

UPDATE "ActivitySubmission"
SET "storageProvider" = 'GOOGLE_DRIVE'
WHERE "driveUrl" IS NOT NULL AND "storageProvider" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ActivitySubmission_fileKey_key"
  ON "ActivitySubmission"("fileKey");
