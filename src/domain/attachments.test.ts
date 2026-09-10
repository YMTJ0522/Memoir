import { describe, expect, it } from "vitest";
import {
  attachmentKindFromExtension,
  attachmentMonthDir,
  attachmentRelativePath,
  attachmentPathsFromDrop,
  collectClipboardAttachmentFiles,
  collectClipboardMediaFiles,
  escapeMarkdownAlt,
  formatBytes,
  isArchiveExtension,
  isAttachmentExtension,
  isAttachmentLikeFile,
  isAudioExtension,
  isAudioPath,
  isDocumentExtension,
  isImageFile,
  isVideoExtension,
  isVideoFile,
  isVideoPath,
  markdownForAttachment,
  markdownForAttachments,
  markdownImageForAttachment,
  maxAttachmentBytesForExtension,
  maxAttachmentBytesForFile,
  padMarkdownBlock,
  sanitizeAttachmentFileName,
  suggestedPasteFileName,
} from "./attachments";

describe("attachments", () => {
  it("sanitizes names and keeps CJK stems", () => {
    expect(sanitizeAttachmentFileName("截图 1.png")).toBe("截图-1.png");
    expect(sanitizeAttachmentFileName("../escape/photo.jpeg")).toBe("photo.jpeg");
    expect(sanitizeAttachmentFileName("...")).toBe("image");
  });

  it("names pasted clipboard images with a timestamp", () => {
    const now = new Date("2026-08-15T14:30:52");
    expect(suggestedPasteFileName({ name: "image.png", type: "image/png" }, now)).toBe(
      "paste-20260815-143052.png",
    );
    expect(suggestedPasteFileName({ name: "diagram.webp", type: "" }, now)).toBe("diagram.webp");
  });

  it("builds markdown that stays relative to the current note", () => {
    const attachment = {
      relativePath: "attachments/2026-08/paste-1.png",
      fileName: "paste-1.png",
      extension: "png",
    };
    expect(markdownImageForAttachment("welcome.md", attachment)).toBe(
      "![paste-1](attachments/2026-08/paste-1.png)",
    );
    expect(markdownImageForAttachment("日记/today.md", attachment)).toBe(
      "![paste-1](../attachments/2026-08/paste-1.png)",
    );
    expect(escapeMarkdownAlt("weird [alt]")).toBe("weird alt");
    expect(
      markdownForAttachments("welcome.md", [
        attachment,
        { relativePath: "attachments/2026-08/b.gif", fileName: "b.gif", extension: "gif" },
      ]),
    ).toBe(
      "![paste-1](attachments/2026-08/paste-1.png)\n\n![b](attachments/2026-08/b.gif)",
    );
  });

  it("inserts embed syntax for media but link syntax for documents and archives", () => {
    expect(
      markdownForAttachment("welcome.md", {
        relativePath: "attachments/2026-09/demo.mp4",
        fileName: "demo.mp4",
        extension: "mp4",
      }),
    ).toBe("![demo](attachments/2026-09/demo.mp4)");
    expect(
      markdownForAttachment("welcome.md", {
        relativePath: "attachments/2026-09/voice.mp3",
        fileName: "voice.mp3",
        extension: "mp3",
      }),
    ).toBe("![voice](attachments/2026-09/voice.mp3)");
    expect(
      markdownForAttachment("welcome.md", {
        relativePath: "attachments/2026-09/报告.docx",
        fileName: "报告.docx",
        extension: "docx",
      }),
    ).toBe("[报告.docx](attachments/2026-09/报告.docx)");
    expect(
      markdownForAttachment("welcome.md", {
        relativePath: "attachments/2026-09/打包.zip",
        fileName: "打包.zip",
        extension: "zip",
      }),
    ).toBe("[打包.zip](attachments/2026-09/打包.zip)");
    expect(
      markdownForAttachment("日记/today.md", {
        relativePath: "attachments/2026-09/预算表.xlsx",
        fileName: "预算表.xlsx",
        extension: "xlsx",
      }),
    ).toBe("[预算表.xlsx](../attachments/2026-09/预算表.xlsx)");
  });

  it("nests new files under a year-month folder", () => {
    const now = new Date("2026-08-15T14:30:52");
    expect(attachmentMonthDir(now)).toBe("2026-08");
    expect(attachmentRelativePath("photo.png", now)).toBe(
      "attachments/2026-08/photo.png",
    );
  });

  it("pads attachment markdown so it does not glue onto the current line", () => {
    expect(padMarkdownBlock("![a](a.png)", "```mermaid", "graph LR")).toBe("\n\n![a](a.png)\n\n");
    expect(padMarkdownBlock("![a](a.png)", "# Title\n\n", "\n\nnext")).toBe("![a](a.png)");
    expect(padMarkdownBlock("![a](a.png)", "line\n", "more")).toBe("\n![a](a.png)\n\n");
  });

  it("formats sizes and recognizes image files", () => {
    expect(formatBytes(800)).toBe("800 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12_288)).toBe("12 KB");
    expect(formatBytes(2_097_152)).toBe("2.0 MB");
    expect(isImageFile({ name: "shot.PNG", type: "" })).toBe(true);
    expect(isImageFile({ name: "notes.md", type: "text/markdown" })).toBe(false);
  });

  it("recognizes video files and separates them from images", () => {
    expect(isVideoFile({ name: "demo.mp4", type: "" })).toBe(true);
    expect(isVideoFile({ name: "clip.webm", type: "video/webm" })).toBe(true);
    expect(isVideoFile({ name: "photo.png", type: "" })).toBe(false);
    expect(isVideoFile({ name: "notes.md", type: "video/mp4" })).toBe(true);
    expect(isImageFile({ name: "demo.mp4", type: "" })).toBe(false);
    expect(isVideoExtension("MP4")).toBe(true);
    expect(isVideoExtension("gif")).toBe(false);
    expect(isAttachmentExtension("mkv")).toBe(true);
  });

  it("detects video paths for preview rendering", () => {
    expect(isVideoPath("attachments/2026-09/demo.mp4")).toBe(true);
    expect(isVideoPath("C:\\videos\\b.WEBM")).toBe(true);
    expect(isVideoPath("attachments/2026-09/photo.png")).toBe(false);
    expect(isVideoPath("https://example.com/video.mp4")).toBe(true);
  });

  it("applies a larger size limit to videos than images", () => {
    expect(maxAttachmentBytesForExtension("png")).toBe(20 * 1024 * 1024);
    expect(maxAttachmentBytesForExtension("svg")).toBe(20 * 1024 * 1024);
    expect(maxAttachmentBytesForExtension("mp4")).toBe(200 * 1024 * 1024);
    expect(maxAttachmentBytesForExtension("mkv")).toBe(200 * 1024 * 1024);
    expect(maxAttachmentBytesForExtension("mp3")).toBe(100 * 1024 * 1024);
    expect(maxAttachmentBytesForExtension("flac")).toBe(100 * 1024 * 1024);
    expect(maxAttachmentBytesForExtension("pdf")).toBe(2 * 1024 * 1024 * 1024);
    expect(maxAttachmentBytesForExtension("docx")).toBe(2 * 1024 * 1024 * 1024);
    expect(maxAttachmentBytesForExtension("zip")).toBe(2 * 1024 * 1024 * 1024);
    expect(maxAttachmentBytesForFile({ name: "a.png", type: "" })).toBe(20 * 1024 * 1024);
    expect(maxAttachmentBytesForFile({ name: "a.mp4", type: "" })).toBe(200 * 1024 * 1024);
    expect(maxAttachmentBytesForFile({ name: "a.bin", type: "video/quicktime" })).toBe(
      200 * 1024 * 1024,
    );
    expect(maxAttachmentBytesForFile({ name: "a.docx", type: "" })).toBe(2 * 1024 * 1024 * 1024);
    expect(maxAttachmentBytesForFile({ name: "a.zip", type: "application/zip" })).toBe(
      2 * 1024 * 1024 * 1024,
    );
  });

  it("classifies attachment kinds for icons and insert syntax", () => {
    expect(attachmentKindFromExtension("png")).toBe("image");
    expect(attachmentKindFromExtension("MP4")).toBe("video");
    expect(attachmentKindFromExtension("m4a")).toBe("audio");
    expect(attachmentKindFromExtension("xlsx")).toBe("document");
    expect(attachmentKindFromExtension("epub")).toBe("document");
    expect(attachmentKindFromExtension("7z")).toBe("archive");
    expect(isDocumentExtension("pptx")).toBe(true);
    expect(isDocumentExtension("exe")).toBe(false);
    expect(isArchiveExtension("rar")).toBe(true);
    expect(isArchiveExtension("tar")).toBe(true);
    expect(isAudioExtension("MP3")).toBe(true);
    expect(isAudioPath("attachments/2026-09/voice.ogg")).toBe(true);
    expect(isAudioPath("attachments/2026-09/photo.png")).toBe(false);
  });

  it("recognizes document and archive files for drag/paste handling", () => {
    expect(isAttachmentLikeFile({ name: "报告.docx", type: "" })).toBe(true);
    expect(isAttachmentLikeFile({ name: "打包.zip", type: "application/zip" })).toBe(true);
    expect(isAttachmentLikeFile({ name: "录音.mp3", type: "audio/mpeg" })).toBe(true);
    expect(isAttachmentLikeFile({ name: "photo.png", type: "" })).toBe(true);
    expect(isAttachmentLikeFile({ name: "program.exe", type: "" })).toBe(false);
    expect(isImageFile({ name: "notes.md", type: "" })).toBe(false);
  });

  it("collects any supported attachment from clipboard items", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const docx = new File([new Uint8Array([4, 5, 6])], "报告.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const zip = new File([new Uint8Array([7, 8])], "打包.zip", { type: "" });
    const exe = new File([new Uint8Array([9])], "run.exe", { type: "" });
    const data = {
      items: [
        { kind: "file", type: png.type, getAsFile: () => png },
        { kind: "file", type: docx.type, getAsFile: () => docx },
        { kind: "file", type: zip.type, getAsFile: () => zip },
        { kind: "file", type: exe.type, getAsFile: () => exe },
      ],
      files: [png, docx, zip, exe],
    } as unknown as DataTransfer;
    expect(collectClipboardAttachmentFiles(data)).toEqual([png, docx, zip]);
    expect(collectClipboardMediaFiles(data)).toEqual([png]);
    expect(collectClipboardAttachmentFiles(null)).toEqual([]);
  });

  it("collects image files from clipboard items", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const data = {
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => png,
        },
      ],
      files: [png],
    } as unknown as DataTransfer;
    expect(collectClipboardMediaFiles(data)).toEqual([png]);
    expect(collectClipboardMediaFiles(null)).toEqual([]);
  });

  it("collects image clipboard items even when kind is not file", () => {
    const png = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const data = {
      items: [
        {
          kind: "string",
          type: "image/png",
          getAsFile: () => png,
        },
      ],
      files: [],
    } as unknown as DataTransfer;
    expect(collectClipboardMediaFiles(data)).toEqual([png]);
  });

  it("keeps only attachment paths from a native file drop", () => {
    expect(
      attachmentPathsFromDrop([
        "/tmp/photo.PNG",
        "/tmp/数据.zip",
        "C:\\shots\\a.webp",
        "C:\\videos\\b.mp4",
        "C:\\docs\\报告.docx",
        "C:\\run.exe",
      ]),
    ).toEqual([
      "/tmp/photo.PNG",
      "/tmp/数据.zip",
      "C:\\shots\\a.webp",
      "C:\\videos\\b.mp4",
      "C:\\docs\\报告.docx",
    ]);
  });
});
