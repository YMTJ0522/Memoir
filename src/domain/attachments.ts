import { relativePathFromNote } from "./paths";

export const ATTACHMENTS_DIR = "attachments";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_ATTACHMENT_BYTES = 200 * 1024 * 1024;
export const MAX_AUDIO_ATTACHMENT_BYTES = 100 * 1024 * 1024;
/** Documents and archives stream from disk on import, so a two-gigabyte cap
 * avoids memory spikes while staying ahead of real-world project archives. */
export const MAX_LARGE_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;

export const IMAGE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "avif",
  "svg",
] as const;

export const VIDEO_EXTENSIONS = [
  "mp4",
  "webm",
  "mov",
  "m4v",
  "avi",
  "mkv",
  "wmv",
] as const;

export const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg", "m4a", "flac"] as const;

export const DOCUMENT_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "md",
  "rtf",
  "odt",
  "ods",
  "odp",
  "epub",
] as const;

export const ARCHIVE_EXTENSIONS = [
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
] as const;

export const ATTACHMENT_EXTENSIONS = [
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...ARCHIVE_EXTENSIONS,
] as const;

/** Attachment kinds beyond plain images drive icon + insert syntax. */
export type AttachmentKind = "image" | "video" | "audio" | "document" | "archive";

export type AttachmentExtension = (typeof ATTACHMENT_EXTENSIONS)[number];

export type AttachmentFile = {
  relativePath: string;
  fileName: string;
  extension: string;
  mimeType: string;
  modifiedMs: number;
  size: number;
};

export type SaveAttachmentInput = {
  bytesBase64: string;
  fileName?: string;
  mimeType?: string;
};

const MIME_TO_EXTENSION: Record<string, AttachmentExtension> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-m4v": "m4v",
  "video/x-msvideo": "avi",
  "video/avi": "avi",
  "video/x-matroska": "mkv",
  "video/x-ms-wmv": "wmv",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/flac": "flac",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/rtf": "rtf",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/epub+zip": "epub",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
  "application/vnd.rar": "rar",
  "application/x-7z-compressed": "7z",
  "application/x-tar": "tar",
  "application/gzip": "gz",
  "application/x-gzip": "gz",
  "application/x-bzip2": "bz2",
  "application/x-xz": "xz",
};

const EXTENSION_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  wmv: "video/x-ms-wmv",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/plain",
  md: "text/plain",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",
  zip: "application/zip",
  rar: "application/vnd.rar",
  "7z": "application/x-7z-compressed",
  tar: "application/x-tar",
  gz: "application/gzip",
  tgz: "application/gzip",
  bz2: "application/x-bzip2",
  xz: "application/x-xz",
};

const IMAGE_EXTENSION_SET = new Set<string>(IMAGE_EXTENSIONS);
const VIDEO_EXTENSION_SET = new Set<string>(VIDEO_EXTENSIONS);
const AUDIO_EXTENSION_SET = new Set<string>(AUDIO_EXTENSIONS);
const DOCUMENT_EXTENSION_SET = new Set<string>(DOCUMENT_EXTENSIONS);
const ARCHIVE_EXTENSION_SET = new Set<string>(ARCHIVE_EXTENSIONS);

const GENERIC_STEM = /^(image|blob|untitled|paste|screenshot)(\s*[-_]?\d+)?$/i;

export function isAttachmentExtension(value: string): value is AttachmentExtension {
  return (ATTACHMENT_EXTENSIONS as readonly string[]).includes(value.toLowerCase());
}

export function isImageExtension(value: string): boolean {
  return IMAGE_EXTENSION_SET.has(value.toLowerCase());
}

export function isVideoExtension(value: string): boolean {
  return VIDEO_EXTENSION_SET.has(value.toLowerCase());
}

export function isAudioExtension(value: string): boolean {
  return AUDIO_EXTENSION_SET.has(value.toLowerCase());
}

export function isDocumentExtension(value: string): boolean {
  return DOCUMENT_EXTENSION_SET.has(value.toLowerCase());
}

export function isArchiveExtension(value: string): boolean {
  return ARCHIVE_EXTENSION_SET.has(value.toLowerCase());
}

/** Maps an extension to the coarse attachment kind used for icons and insert syntax. */
export function attachmentKindFromExtension(extension: string): AttachmentKind {
  const value = extension.toLowerCase();
  if (IMAGE_EXTENSION_SET.has(value)) return "image";
  if (VIDEO_EXTENSION_SET.has(value)) return "video";
  if (AUDIO_EXTENSION_SET.has(value)) return "audio";
  if (ARCHIVE_EXTENSION_SET.has(value)) return "archive";
  return "document";
}

export function maxAttachmentBytesForExtension(extension: string): number {
  const value = extension.toLowerCase();
  if (VIDEO_EXTENSION_SET.has(value)) return MAX_VIDEO_ATTACHMENT_BYTES;
  if (AUDIO_EXTENSION_SET.has(value)) return MAX_AUDIO_ATTACHMENT_BYTES;
  if (DOCUMENT_EXTENSION_SET.has(value) || ARCHIVE_EXTENSION_SET.has(value)) {
    return MAX_LARGE_ATTACHMENT_BYTES;
  }
  return MAX_ATTACHMENT_BYTES;
}

export function maxAttachmentBytesForFile(file: { name: string; type: string }): number {
  const byMime = extensionFromMime(file.type);
  if (byMime) return maxAttachmentBytesForExtension(byMime);
  const byName = extensionFromFileName(file.name);
  return maxAttachmentBytesForExtension(byName || "");
}

export function extensionFromMime(mimeType: string): AttachmentExtension | null {
  return MIME_TO_EXTENSION[mimeType.trim().toLowerCase()] ?? null;
}

export function mimeFromExtension(extension: string): string {
  return EXTENSION_TO_MIME[extension.toLowerCase()] ?? "application/octet-stream";
}

export function extensionFromFileName(fileName: string): AttachmentExtension | null {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  return isAttachmentExtension(match[1]) ? match[1] : null;
}

export function isImageFile(file: { name: string; type: string }): boolean {
  const byMime = extensionFromMime(file.type);
  if (byMime) return isImageExtension(byMime);
  const byName = extensionFromFileName(file.name);
  return byName ? isImageExtension(byName) : false;
}

export function isVideoFile(file: { name: string; type: string }): boolean {
  const byMime = extensionFromMime(file.type);
  if (byMime) return isVideoExtension(byMime);
  const byName = extensionFromFileName(file.name);
  return byName ? isVideoExtension(byName) : false;
}

export function isMediaFile(file: { name: string; type: string }): boolean {
  return isImageFile(file) || isVideoFile(file);
}

export function isAttachmentLikeFile(file: { name: string; type: string }): boolean {
  const byMime = extensionFromMime(file.type);
  if (byMime) return isAttachmentExtension(byMime);
  const byName = extensionFromFileName(file.name);
  return byName ? true : false;
}

export function isAudioPath(path: string): boolean {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return Boolean(match && isAudioExtension(match[1]));
}

export function isAttachmentPath(path: string): boolean {
  return Boolean(extensionFromFileName(path.split(/[\\/]/).pop() || path));
}

export function isVideoPath(path: string): boolean {
  const match = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return Boolean(match && isVideoExtension(match[1]));
}

export function attachmentPathsFromDrop(paths: string[]): string[] {
  return paths.filter(isAttachmentPath);
}

export function sanitizeAttachmentFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop()?.trim() ?? "";
  let slug = "";
  let lastDash = false;
  for (const character of base) {
    if (character === ".") {
      if (slug && !slug.endsWith(".")) slug += ".";
      lastDash = false;
      continue;
    }
    if (/\p{Letter}|\p{Number}|_/u.test(character)) {
      slug += character;
      lastDash = false;
      continue;
    }
    if (!lastDash && slug) {
      slug += "-";
      lastDash = true;
    }
  }
  return slug.replace(/^[.-]+|[.-]+$/g, "") || "image";
}

export function formatStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function attachmentMonthDir(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function attachmentRelativePath(fileName: string, date = new Date()): string {
  return `${ATTACHMENTS_DIR}/${attachmentMonthDir(date)}/${fileName}`;
}

export function suggestedPasteFileName(
  file: { name: string; type: string },
  now = new Date(),
): string {
  const extension = extensionFromMime(file.type) ?? extensionFromFileName(file.name) ?? "png";
  const rawStem = file.name.replace(/\.[^.]+$/, "").trim();
  const generic = !rawStem || GENERIC_STEM.test(rawStem);
  const stem = generic ? `paste-${formatStamp(now)}` : sanitizeAttachmentFileName(rawStem);
  return `${stem}.${extension}`;
}

export function escapeMarkdownAlt(value: string): string {
  return value.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim() || "image";
}

export function attachmentAlt(attachment: Pick<AttachmentFile, "fileName">): string {
  return escapeMarkdownAlt(attachment.fileName.replace(/\.[^.]+$/, ""));
}

export function markdownImageForAttachment(
  noteRelativePath: string,
  attachment: Pick<AttachmentFile, "relativePath" | "fileName">,
  alt = attachmentAlt(attachment),
): string {
  const href = relativePathFromNote(noteRelativePath, attachment.relativePath);
  return `![${alt}](${href})`;
}

/**
 * Insert syntax per kind: images/videos/audio embed via `![alt](path)`
 * (video and audio render inline players), documents and archives insert
 * a plain `[filename](path)` link that opens with the system handler.
 */
export function markdownForAttachment(
  noteRelativePath: string,
  attachment: Pick<AttachmentFile, "relativePath" | "fileName" | "extension">,
): string {
  const kind = attachmentKindFromExtension(attachment.extension);
  if (kind === "document" || kind === "archive") {
    const href = relativePathFromNote(noteRelativePath, attachment.relativePath);
    return `[${attachment.fileName}](${href})`;
  }
  return markdownImageForAttachment(noteRelativePath, attachment);
}

export function markdownForAttachments(
  noteRelativePath: string | null,
  attachments: Array<Pick<AttachmentFile, "relativePath" | "fileName" | "extension">>,
): string {
  if (!noteRelativePath || attachments.length === 0) return "";
  return attachments
    .map((attachment) => markdownForAttachment(noteRelativePath, attachment))
    .join("\n\n");
}

export function padMarkdownBlock(text: string, before: string, after: string): string {
  let prefix = "";
  if (before && !before.endsWith("\n\n")) {
    prefix = before.endsWith("\n") ? "\n" : "\n\n";
  }
  let suffix = "";
  if (after && !after.startsWith("\n\n")) {
    suffix = after.startsWith("\n") ? "\n" : "\n\n";
  }
  return `${prefix}${text}${suffix}`;
}

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) {
    const kb = size / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export function collectClipboardMediaFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" && !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file && isMediaFile(file)) fromItems.push(file);
  }
  if (fromItems.length) return uniqueFiles(fromItems);
  return uniqueFiles(Array.from(data.files ?? []).filter(isMediaFile));
}

/**
 * Collects every supported attachment from a clipboard/drag payload: images
 * and videos (inline previews) plus documents, archives and audio (links).
 */
export function collectClipboardAttachmentFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file" && !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file && isAttachmentLikeFile(file)) fromItems.push(file);
  }
  if (fromItems.length) return uniqueFiles(fromItems);
  return uniqueFiles(Array.from(data.files ?? []).filter(isAttachmentLikeFile));
}

function uniqueFiles(files: File[]): File[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
