# Cloudflare R2 setup for SAGA assignment submissions

## 1. Create a bucket and access key

Create a dedicated R2 bucket for assignment uploads. Create an R2 API token scoped to this bucket with Object Read and Object Write permissions. Keep the Access Key ID and Secret Access Key server-side.

Configure these variables in Vercel Production, Preview, and local development:

```dotenv
R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
R2_PUBLIC_URL=https://files.example.com
```

R2_PUBLIC_URL is the public custom domain mapped to the bucket and is used for direct links shown to teachers and students. Use HTTPS. Never prefix credentials with NEXT_PUBLIC_.

## 2. Configure bucket CORS

Replace the origins with the exact SAGA origins used by each environment:

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

Add the exact Vercel preview origin when testing from a preview URL. CORS is required because browsers upload directly to R2. Presigned URLs expire after 15 minutes and sign the Content-Type header.

## 3. Per-file upload policy

- **5 MB or smaller:** upload directly from the student's browser to R2. Any file type is accepted, and there is no application-level attachment-count limit. The 5 MB cap applies to each file individually, not the combined submission size.
- **Above 5 MB:** SAGA does not upload the file to R2. The student uploads it to Google Drive and pastes its HTTPS share link in the assignment form. Students should check that the teacher has permission to open the shared file.
- The student can mix small R2 files and larger Google Drive links in the same submission.
- Each submission is stored as one row with a related attachment record per file/link. Resubmission replaces the attachment list for that submission.

## 4. File privacy

R2 fileUrl links use the configured public custom domain. Anyone who obtains an R2 URL can read that object. Keep this bucket dedicated to assignment attachments and avoid putting confidential records in it. Google Drive access still follows the sharing permissions the student configures in Drive. For private R2 downloads, the next security improvement would be authenticated short-lived presigned GET URLs rather than public object URLs.

## 5. Upload flow

1. The authenticated student requests a presigned PUT URL for each selected file of 5 MB or less.
2. The browser uploads each file directly to R2. File bytes do not pass through a Next.js route or Server Action.
3. Larger files are represented by Google Drive share links and never pass through Vercel or R2.
4. The browser posts only text and attachment metadata to /api/submissions. The server checks each R2 object with HeadObject and validates Google Drive URLs before saving.
