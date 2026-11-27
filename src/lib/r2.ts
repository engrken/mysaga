import { S3Client } from "@aws-sdk/client-s3";

let client: S3Client | null = null;

function requiredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is not configured.");
  return value;
}

export function getR2BucketName(): string {
  return requiredValue("R2_BUCKET_NAME");
}

export function getR2Client(): S3Client {
  if (client) return client;
  const endpoint = requiredValue("R2_ENDPOINT");
  const accessKeyId = requiredValue("R2_ACCESS_KEY_ID");
  const secretAccessKey = requiredValue("R2_SECRET_ACCESS_KEY");
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.protocol !== "https:" || endpointUrl.username || endpointUrl.password ||
      endpointUrl.search || endpointUrl.hash) {
    throw new Error("R2_ENDPOINT must be a valid HTTPS Cloudflare R2 S3 endpoint.");
  }
  client = new S3Client({
    region: "auto",
    endpoint: endpointUrl.toString().replace(/\/$/, ""),
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 2
  });
  return client;
}

export function sanitizeR2FileName(value: string): string {
  const normalized = value.normalize("NFKC").replace(/[\/\\]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(-120);
  return normalized || "attachment";
}


/** Stable application URL; the actual object remains private in R2. */
export function getR2PrivateDownloadPath(fileKey: strin¶»§q«^