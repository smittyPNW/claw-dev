import path from "node:path";

export type IncomingChatAttachment = {
  name?: string;
  mimeType?: string;
  dataBase64?: string;
};

export type ChatAttachment =
  | {
      kind: "image";
      name: string;
      mimeType: string;
      size: number;
      dataBase64: string;
      dataUrl: string;
    }
  | {
      kind: "text";
      name: string;
      mimeType: string;
      size: number;
      text: string;
      truncated: boolean;
    }
  | {
      kind: "binary";
      name: string;
      mimeType: string;
      size: number;
    };

const MAX_ATTACHMENTS = 6;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 16000;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".csv",
  ".tsv",
  ".html",
  ".css",
  ".scss",
  ".less",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".sh",
  ".zsh",
  ".bash",
  ".sql",
  ".xml",
  ".svg",
  ".env",
]);

export function normalizeChatAttachments(rawAttachments: unknown): ChatAttachment[] {
  if (!Array.isArray(rawAttachments)) {
    return [];
  }

  const attachments: ChatAttachment[] = [];

  for (const rawAttachment of rawAttachments.slice(0, MAX_ATTACHMENTS)) {
    if (!isIncomingAttachment(rawAttachment)) {
      continue;
    }

    const name = sanitizeAttachmentName(rawAttachment.name);
    const mimeType = sanitizeMimeType(rawAttachment.mimeType, name);
    const dataBase64 = typeof rawAttachment.dataBase64 === "string" ? rawAttachment.dataBase64.trim() : "";
    if (!dataBase64) {
      continue;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(dataBase64, "base64");
    } catch {
      continue;
    }

    if (buffer.byteLength === 0 || buffer.byteLength > MAX_ATTACHMENT_BYTES) {
      continue;
    }

    if (mimeType.startsWith("image/")) {
      attachments.push({
        kind: "image",
        name,
        mimeType,
        size: buffer.byteLength,
        dataBase64,
        dataUrl: `data:${mimeType};base64,${dataBase64}`,
      });
      continue;
    }

    if (isTextLikeAttachment(mimeType, name)) {
      const rawText = buffer.toString("utf8");
      const truncated = rawText.length > MAX_TEXT_ATTACHMENT_CHARS;
      attachments.push({
        kind: "text",
        name,
        mimeType,
        size: buffer.byteLength,
        text: truncated ? `${rawText.slice(0, MAX_TEXT_ATTACHMENT_CHARS)}\n\n[truncated]` : rawText,
        truncated,
      });
      continue;
    }

    attachments.push({
      kind: "binary",
      name,
      mimeType,
      size: buffer.byteLength,
    });
  }

  return attachments;
}

export function buildAttachmentAwarePrompt(prompt: string, attachments: ChatAttachment[]): string {
  const trimmedPrompt = prompt.trim();
  const textSections = attachments
    .filter((attachment): attachment is Extract<ChatAttachment, { kind: "text" }> => attachment.kind === "text")
    .map((attachment) => {
      const extension = path.extname(attachment.name).replace(/^\./, "") || "txt";
      const truncationNote = attachment.truncated ? "\n[This file was truncated for context size.]" : "";
      return [
        `Attached file: ${attachment.name}`,
        "```" + extension,
        attachment.text,
        "```",
        truncationNote,
      ]
        .filter(Boolean)
        .join("\n");
    });

  const binarySummary = attachments
    .filter((attachment): attachment is Extract<ChatAttachment, { kind: "binary" }> => attachment.kind === "binary")
    .map((attachment) => `Attached binary file: ${attachment.name} (${attachment.mimeType}, ${formatAttachmentSize(attachment.size)})`);

  const imageSummary = attachments
    .filter((attachment): attachment is Extract<ChatAttachment, { kind: "image" }> => attachment.kind === "image")
    .map((attachment) => `Attached image: ${attachment.name} (${attachment.mimeType}, ${formatAttachmentSize(attachment.size)})`);

  const sections = [
    trimmedPrompt,
    ...(imageSummary.length > 0 ? ["", "Image attachments:", ...imageSummary] : []),
    ...(binarySummary.length > 0 ? ["", "Other attachments:", ...binarySummary] : []),
    ...(textSections.length > 0 ? ["", "Attached file contents:", ...textSections] : []),
  ].filter(Boolean);

  return sections.join("\n");
}

export function buildOpenAIUserContent(prompt: string, attachments: ChatAttachment[]): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: buildAttachmentAwarePrompt(prompt, attachments),
    },
  ];

  for (const attachment of attachments) {
    if (attachment.kind !== "image") {
      continue;
    }

    content.push({
      type: "image_url",
      image_url: {
        url: attachment.dataUrl,
      },
    });
  }

  return content;
}

export function buildResponsesUserContent(prompt: string, attachments: ChatAttachment[]): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "input_text",
      text: buildAttachmentAwarePrompt(prompt, attachments),
    },
  ];

  for (const attachment of attachments) {
    if (attachment.kind !== "image") {
      continue;
    }

    content.push({
      type: "input_image",
      image_url: attachment.dataUrl,
    });
  }

  return content;
}

export function buildAnthropicUserContent(prompt: string, attachments: ChatAttachment[]): Array<Record<string, unknown>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: buildAttachmentAwarePrompt(prompt, attachments),
    },
  ];

  for (const attachment of attachments) {
    if (attachment.kind !== "image") {
      continue;
    }

    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mimeType,
        data: attachment.dataBase64,
      },
    });
  }

  return content;
}

export function buildGeminiUserParts(prompt: string, attachments: ChatAttachment[]): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [
    {
      text: buildAttachmentAwarePrompt(prompt, attachments),
    },
  ];

  for (const attachment of attachments) {
    if (attachment.kind !== "image") {
      continue;
    }

    parts.push({
      inlineData: {
        mimeType: attachment.mimeType,
        data: attachment.dataBase64,
      },
    });
  }

  return parts;
}

function isIncomingAttachment(value: unknown): value is IncomingChatAttachment {
  return typeof value === "object" && value !== null;
}

function sanitizeAttachmentName(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return "attachment";
  }

  return raw.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
}

function sanitizeMimeType(value: unknown, fileName: string): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw) {
    return raw;
  }

  const extension = path.extname(fileName).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json";
    case ".pdf":
      return "application/pdf";
    default:
      return "application/octet-stream";
  }
}

function isTextLikeAttachment(mimeType: string, fileName: string): boolean {
  if (mimeType.startsWith("text/")) {
    return true;
  }

  if (
    mimeType === "application/json" ||
    mimeType === "application/xml" ||
    mimeType === "application/javascript" ||
    mimeType === "application/x-sh" ||
    mimeType === "image/svg+xml"
  ) {
    return true;
  }

  return TEXT_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function formatAttachmentSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
