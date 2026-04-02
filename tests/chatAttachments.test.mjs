import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAttachmentAwarePrompt,
  buildOpenAIUserContent,
  normalizeChatAttachments,
} from "../dist/chatAttachments.js";

test("normalizeChatAttachments turns images and text files into provider-ready attachments", () => {
  const imageBase64 = Buffer.from("fake-image").toString("base64");
  const textBase64 = Buffer.from("print('hello')\n", "utf8").toString("base64");

  const attachments = normalizeChatAttachments([
    {
      name: "diagram.png",
      mimeType: "image/png",
      dataBase64: imageBase64,
    },
    {
      name: "snake.py",
      mimeType: "text/x-python",
      dataBase64: textBase64,
    },
  ]);

  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].kind, "image");
  assert.match(attachments[0].dataUrl, /^data:image\/png;base64,/);
  assert.equal(attachments[1].kind, "text");
  assert.match(attachments[1].text, /print\('hello'\)/);
});

test("buildAttachmentAwarePrompt folds text and binary summaries into the prompt", () => {
  const attachments = normalizeChatAttachments([
    {
      name: "notes.md",
      mimeType: "text/markdown",
      dataBase64: Buffer.from("# Notes\nhello", "utf8").toString("base64"),
    },
    {
      name: "archive.zip",
      mimeType: "application/zip",
      dataBase64: Buffer.from([1, 2, 3, 4]).toString("base64"),
    },
  ]);

  const prompt = buildAttachmentAwarePrompt("Review this.", attachments);
  assert.match(prompt, /Attached file contents:/);
  assert.match(prompt, /notes\.md/);
  assert.match(prompt, /Other attachments:/);
  assert.match(prompt, /archive\.zip/);
});

test("buildOpenAIUserContent keeps image attachments as image_url parts", () => {
  const attachments = normalizeChatAttachments([
    {
      name: "moodboard.jpg",
      mimeType: "image/jpeg",
      dataBase64: Buffer.from("jpeg-data").toString("base64"),
    },
  ]);

  const content = buildOpenAIUserContent("Describe this image.", attachments);
  assert.equal(content[0].type, "text");
  assert.equal(content[1].type, "image_url");
  assert.match(content[1].image_url.url, /^data:image\/jpeg;base64,/);
});
