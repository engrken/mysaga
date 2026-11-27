# Cloudflare R2 setup for SAGA assignment submissions

## 1. Create a bucket and access key

Create a dedicated R2 bucket for assignment uploads. Create an R2 API token scoped to this bucket with Object Read and Object Write permissions. Copy the Access Key ID and Secret Access Key once; keep both server-side.

Configure these variables in Vercel Production, Preview, and local development as appropriate:

```dotenv
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=https://files.example.com
```

R2_PUBLIC_URL is the public custom domain mapped to the bucket and is used for direct links shown to teachers and students. Use HTTPS. Do not prefix credentials with NEXT_PUBLIC_.

## 2. Configure bucket CORS

Add a bucket CORS policy. Replace the origins with the exact SAGA origins used by each environment:

```json
[
  {
    "AllowedOrigins": [
      "https://mysaga.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Add the exact Vercel preview origin when testing uploads from a preview URL. CORS is required because the browser sends the PUT request directly to R2. The presigned URL expires after 15 minutes and signs Content-Type; the browser must send the same value.

## 3. File privacy

This implementation returns a direct fileUrl under R2_PUBLIC_URL. The bucket/custom domain must be publicly readable for those links to work, and anyone who obtains a file URL can read that object. Keep this bucket dedicated to assignment uploads, use unguessable object keys, and avoid sensitive personal records or confidential documents. A private bucket needs authenticated downloads through short-lived presigned GET URLs instead of public links.

## 4. Upload flow and limits

1. The authenticated student requests a presigned PUT URL from /api/submissions/upload-url.
2. The browser sends the file bytes directly to that URL using fetch with method PUT and body file. File bytes never pass through a Next.js route or Server Action.
3. After upload succeeds, the browser posts only metadata and optional text to /api/submissions. The server verifies the uploaded object with HeadObject before upserting the ActivitySubmission.

The current UI accepts one file per assignment submission, up to 15 MB. Resubmission reuses the unique [activityId, enrollmentId] record and replaces the previous R2 object when applicable. Legacy Vercel Blob and Google Drive submissions remain accessible.
