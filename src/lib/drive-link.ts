const DRIVE_FILE_ID = "[A-Za-z0-9_-]+";

export function validDriveLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.searchParams.has("authuser") && url.searchParams.get("authuser") === ""
    ) {
      return false;
    }

    if (url.hostname === "drive.google.com") {
      const filePath = new RegExp("^/file/d/" + DRIVE_FILE_ID + "(?:/|$)");
      if (filePath.test(url.pathname)) return true;

      if (url.pathname === "/open" || url.pathname === "/uc") {
        return new RegExp("^" + DRIVE_FILE_ID + "$").test(url.searchParams.get("id") || "");
      }
      return false;
    }

    if (url.hostname === "docs.google.com") {
      const documentPath = new RegExp(
        "^/(?:document|spreadsheets|presentation|drawings)/d/" + DRIVE_FILE_ID + "(?:/|$)"
      );
      const formPath = new RegExp("^/forms/d/(?:e/)?" + DRIVE_FILE_ID + "(?:/|$)");
      return documentPath.test(url.pathname) || formPath.test(url.pathname);
    }

    return false;
  } catch {
    return false;
  }
}
