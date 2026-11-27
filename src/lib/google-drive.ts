export type DrivePermission = { id: string; emailAddress?: string; role?: string; type?: string };
export type DriveFileMetadata = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  trashed?: boolean;
};

export async function googleDriveRequest<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch("https://www.googleapis.com/drive/v3/" + path.replace(/^\//, ""), {
    ...init,
    headers: {
      Authorization: "Bearer " + accessToken,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {})
    },
    cache: "no-store"
  });
  const data = await response.json().catch(() => null) as T | null;
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? String((data as { error?: { message?: string } }).error?.message || "Google Drive request failed.")
      : "Google Drive request failed.";
    const failure = new Error(message) as Error & { status?: number };
    failure.status = response.status;
    throw failure;
  }
  return data as T;
}
