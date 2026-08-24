import { createHash, randomUUID } from "node:crypto";
import { openSync, closeSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";

const DATA_URL_PATTERN = /^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u;
const STAGED_IMAGE_TTL_MS = 30 * 60 * 1_000;
const IMAGE_EXTENSIONS = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function detectImageMediaType(content) {
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (content.length >= 8 && content.subarray(0, 8).equals(pngSignature)) return "image/png";
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) {
    return "image/jpeg";
  }
  const signature = content.subarray(0, 6).toString("ascii");
  if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString("ascii") === "RIFF" &&
    content.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return undefined;
}

function decodeBase64Image(encoded, declaredMediaType) {
  if (
    encoded.length === 0 ||
    encoded.length > Math.ceil((workerData.maxImageBytes * 4) / 3) + 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(encoded)
  )
    return undefined;
  const content = Buffer.from(encoded, "base64");
  const mediaType = detectImageMediaType(content);
  if (
    content.length === 0 ||
    content.length > workerData.maxImageBytes ||
    content.toString("base64").replace(/=+$/u, "") !== encoded.replace(/=+$/u, "") ||
    mediaType === undefined ||
    (declaredMediaType !== undefined && mediaType !== declaredMediaType)
  )
    return undefined;
  return { content, mediaType };
}

function hasValidSavedImage(path) {
  let descriptor;
  try {
    if (!isAbsolute(path)) return false;
    const stats = statSync(path);
    if (!stats.isFile() || stats.size <= 0 || stats.size > workerData.maxImageBytes) return false;
    // savedPath 只读取签名所需头部，避免把已有图片正文再次载入内存。
    descriptor = openSync(path, "r");
    const header = Buffer.alloc(12);
    const bytesRead = readSync(descriptor, header, 0, header.length, 0);
    return detectImageMediaType(header.subarray(0, bytesRead)) !== undefined;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function stageImage(image) {
  const contentDigest = createHash("sha256").update(image.content).digest("hex");
  const path = join(
    workerData.stagingDirectory,
    `${randomUUID()}${IMAGE_EXTENSIONS[image.mediaType]}`,
  );
  writeFileSync(path, image.content, { flag: "wx" });
  const cleanupTimer = setTimeout(() => {
    rmSync(path, { force: true });
  }, STAGED_IMAGE_TTL_MS);
  cleanupTimer.unref();
  return { contentDigest, mediaType: image.mediaType, path, size: image.content.length };
}

function transformImage(record) {
  if (record.type === "imageGeneration") {
    if (typeof record.savedPath === "string" && hasValidSavedImage(record.savedPath)) {
      // 有效 savedPath 已包含正文，禁止把冗余 Base64 克隆回主线程。
      delete record.result;
      return;
    }
    if (typeof record.result === "string") {
      const image = decodeBase64Image(record.result);
      delete record.result;
      if (image !== undefined) {
        delete record.savedPath;
        record[workerData.marker] = stageImage(image);
      }
    }
    return;
  }
  if (
    record.type === "image" &&
    typeof record.url === "string" &&
    record.url.startsWith("data:image/")
  ) {
    const match = DATA_URL_PATTERN.exec(record.url);
    const image = match === null ? undefined : decodeBase64Image(match[2], match[1]);
    delete record.url;
    if (image !== undefined) record[workerData.marker] = stageImage(image);
  }
}

function transformMessage(message) {
  const isRootRecord = message !== null && typeof message === "object" && !Array.isArray(message);
  const records = isRootRecord ? [message] : [];
  while (records.length > 0) {
    const record = records.pop();
    transformImage(record);
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item !== null && typeof item === "object" && !Array.isArray(item)) records.push(item);
        }
      } else if (value !== null && typeof value === "object") {
        records.push(value);
      }
    }
  }
  return message;
}

parentPort.on("message", ({ frame, id }) => {
  try {
    let message;
    try {
      message = JSON.parse(Buffer.from(frame).toString("utf8"));
    } catch {
      parentPort.postMessage({ code: "json_parse_failed", id, type: "error" });
      return;
    }
    parentPort.postMessage({ id, message: transformMessage(message), type: "result" });
  } catch {
    parentPort.postMessage({ code: "frame_processing_failed", id, type: "error" });
  }
});
