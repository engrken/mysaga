# Private Cloudflare R2 storage for SAGA assignment submissions

## 1. Create a private bucket and scoped access key

Create a dedicated Cloudflare R2 bucket for assignment attachments. Keep public access disabled: do not enable the \`r2.dev\` public URL and do not attach a public custom domain to this bucket.

Create an R2 API token scoped only to this bucket with **Object Read**, **Object Write**, and **Object Delete** permissions. Delete permission is needed when a student replaces an earlier submission. Keep the Access Key ID and Secret Access Key server-side only.

Configure these variables in Vercel Production, Preview, and local development:

~~~dotenv
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
~~~

Use the S3 API endpoint from the Cloudflare account. Do not use the Cloudflare dashboard URL, a bucket URL, or a public \`r2.dev\` URL. Never prefix credentials with \`NEXT_PUBLIC_\`. The public \`R2_PUBLIC_URL\` setting is not used by this private download flow.

## 2. Configure bucket CORS

The browser uploads file bytes directly to R2 using a short-lived presigned PUT URL. The browser does not fetch object data directly: downloads are authorized by SAGA and then redirected to a short-lived presigned GET URL. Configure CORS for the exact SAGA browser origins:

~~~json
[
  {
    "AllowedOrigins": [
      "https://my.sagaportal.online",
      "https://mysaga.vercel.app",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Disposition"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
~~~

Add the exact Vercel Preview hostname when testing from a Preview URL. The browser must send the Content-Type and Content-Disposition headers returned with the presigned upload URL.

## 3. Per-file upload policy

- **5 MB or smaller:** upload directly from the student's browser to private R2. Any browser file type is accepted, and there is no application-level attachment-count limit. The 5 MB cap applies to each file individually, not the combined submission size.
- **Above 5 MB:** SAGA does not upload the file to R2. The student uploads it to Google Drive and attaches its HTTPS file share link. The teacher must have permission to open the file.
- Students can mix small R2 files and larger Google Drive links in one submission.
- Each submission is stored as one row with a related attachment record per file/link. Resubmission replaces the attachment list for that submission.

## 4. Download authorization and privacy

R2 object keys are stored server-side in the database. SAGA does not expose public object URLs or accept arbitrary object keys from the download request. The download endpoint checks that the signed-in student owns the submission or that the signed-in teacher owns the class. Only then does it issue a **three-minute** presigned R2 GET redirect, with the response forced to download as \`application/octet-stream\`.

Existing R2 object keys remain usable through the authenticated endpoint, including older single-file submission records. Google Drive links and legacy Vercel Blob files continue using their existing access paths.

**Important rollout step:** after the private-storage code has been deployed and verified, disable public access to the R2 bucket in Cloudflare (including the \`r2.dev\` URL and any public custom domain attached to the bucket). Do not disable public access before the SAGA authenticated download route is available and tested. This repository change cannot change Cloudflare bucket-public-access settings by itself.

## 5. Upload flow

1. The authenticated student requests a presigned PUT URL for each selected file of 5 MB or less.
2. The browser uploads each file directly to private R2. File bytes do not pass through a Next.js route or Server Action.
3. Larger files are represented by Google Drive share links and never pass through Vercel or R2.
4. The browser posts only text and attachment metadata to \`/api/submissions\`. The server verifies each R2 object with HeadObject before saving the attachment record.
5. When a teacher or the owning student opens an R2 attachment, SAGA authorizes the database record and returns a three-minute signed download redirect.
