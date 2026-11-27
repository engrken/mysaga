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

export function getR2PublicUrl(fileKey: string): string {
  const base = new URL(requiredValue("R2_PUBLIC_URL"));
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password ||
      base.search || base.hash || (process.env.NODE_ENV === "production" && base.protocol !== "https:")) {
    throw new Error("R2_PUBLIC_URL must be a valid HTTPS public bucket/custom-domain URL.");
  }
  const prefix = base.pathname.replace(/\/+$/, "");
  const suffix = fileKey.split("/").map(segment => encodeURIComponent(segment)).join("/");
  return base.origin + prefix + "/" + suffix;
}
