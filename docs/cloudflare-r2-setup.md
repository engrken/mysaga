# Private Cloudflare R2 storage for SAGA

SAGA uses Cloudflare R2 for small student assignment attachments and teacher-uploaded class resources. R2 objects are private. Students and teachers receive a short-lived, application-authorized download redirect; no public bucket URL is stored in submission records.

## 1. Create a private bucket and scoped credentials

Create a dedicated R2 bucket. Keep public access disabled: do not enable r2.dev public access and do not attach a publicly accessible custom domain to this bucket.

Create an R2 API token scoped only to this bucket with Object Read, Object Write, and Object Delete permissions. Keep the Access Key ID and Secret Access Key server-side.

Configure these variables in Vercel Production, Preview, and local development:

~~~dotenv
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
~~~

R2_ENDPOINT must be the S3 API endpoint from the Cloudflare account, not the dashboard URL, bucket URL, or a public r2.dev URL. Never prefix credentials with NEXT_PUBLIC_. R2_PUBLIC_URL is no longer used by the private SAGA download flow and is not required.

## 2. Configure bucket CORS

Replace origins with the exact SAGA origins used by each environment:

~~~json
[
  {
    "AllowedOrigins": [
      "https://mysaga.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Disposition"],
    "Expo¶»§q«^