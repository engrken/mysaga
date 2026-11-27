"use client";

import { useEffect, useState } from "react";

type Resource = {
  id: string;
  storageProvider: "GOOGLE_DRIVE" | "CLOUDFLARE_R2";
  googleDriveFileId: string | null;
  fileUrl: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  publishedAt: string;
};
type PickerConfig = {
  apiKey: string;
  projectNumber: string;
  accessToken: string;
  googleEmail: string;
};
type PickerDocument = { id: string; name?: string; mimeType?: string; sizeBytes?: number };
type PickerCallbackData = {
  action?: string;
  docs?: PickerDocument[];
};
type GooglePicker = { setVisible(visible: boolean): void };
type GooglePickerBuilder = {
  addView(view: unknown): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setAppId(projectNumber: string): GooglePickerBuilder;
  setOrigin(origin: string): GooglePickerBuilder;
  setCallback(callback: (data: PickerCallbackData) => void): GooglePickerBuilder;
  build(): GooglePicker;
};
type GoogleNamespace = {
  load(name: string, options: { callback: () => void }): void;
  picker: {
    Action: { PICKED: string; CANCEL: string };
    DocsUploadView: new () => unknown;
    DocsView: new () => { setIncludeFolders(value: boolean): unknown };
    PickerBuilder: new () => GooglePickerBuilder;
  };
};
declare global {
  interface Window {
    gapi?: GoogleNamespace;
  }
}

type Props = { subjectId: string; readOnly?: boolean };

function sizeLabel(bytes:¶»§q«^