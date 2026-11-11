import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";
import sql from "../../protocol/src/acp-plan-resource-sql.json" with { type: "json" };
import { createAcpScheduledPlanOperations } from "./acp-scheduled-plan-worker.js";
const fail = () => {
  throw new Error("Invalid ACP plan resource");
};
function text(v, max) {
  if (typeof v !== "string" || !v.length || v.length > max) fail();
  return v;
}
function scope(p) {
  if (!["web", "desktop"].includes(p?.source)) fail();
  return [p.source, text(p.scheduleId, 256), text(p.projectId, 128)];
}
function key(p) {
  return [text(p.token, 128), ...scope(p)];
}
function attachment(a) {
  if (!a || Object.keys(a).length !== 5 || !["file", "image", "text"].includes(a.kind)) fail();
  text(a.id, 256);
  text(a.name, 255);
  text(a.mediaType, 255);
  const max = a.kind === "text" ? 1048576 : a.kind === "image" ? 10485760 : 52428800;
  if (!Number.isSafeInteger(a.size) || a.size < 1 || a.size > max) fail();
  if (a.kind === "text" && a.mediaType !== "text/plain") fail();
  if (
    a.kind === "image" &&
    !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(a.mediaType)
  )
    fail();
  return { id: a.id, kind: a.kind, mediaType: a.mediaType, name: a.name, size: a.size };
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function record(row) {
  if (!row) fail();
  const metadata = attachment(JSON.parse(row.metadata_json));
  if (metadata.size !== row.size) fail();
  return {
    token: row.token,
    attachment: metadata,
    digest: row.digest,
    written: row.written,
    boundRevision: row.bound_revision,
  };
}
/** 每次只传递一小块原始字节；封存与引用绑定都在 Worker 内校验，不改旧附件表。 */
export function createAcpPlanResourceOperations(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='acp_scheduled_plans'").get()) return {};
  db.exec(sql.schema);
  const plans = createAcpScheduledPlanOperations(db);
  const row = (p) => {
    const value = db.prepare(sql.read).get(...key(p));
    if (!value) fail();
    // 持久元数据被破坏时明确失败，不能用虚假的小尺寸绕过交付容量校验。
    if (attachment(JSON.parse(value.metadata_json)).size !== value.size) fail();
    return value;
  };
  const chunk = (p) => {
    const r = row(p);
    if (!r.digest || !Number.isSafeInteger(p.offset) || p.offset < 0 || p.offset > r.size) fail();
    if (p.offset === r.size) return null;
    const c = db.prepare(sql.chunk).get(r.token, p.offset);
    if (!c || c.content.length > r.size - p.offset || digest(c.content) !== c.digest) fail();
    return c.content;
  };
  const begin = db.transaction((p) => {
    const k = key(p),
      a = attachment(p.attachment);
    const old = db.prepare(sql.read).get(...k);
    if (old) {
      if (JSON.stringify(record(old).attachment) !== JSON.stringify(a)) fail();
      return record(old);
    }
    db.prepare(sql.expire).run(Date.now() - 86400000);
    db.prepare(sql.begin).run(...k, JSON.stringify(a), a.size, Date.now());
    return record(row(p));
  });
  const append = db.transaction((p) => {
    // 偏移与块摘要共同识别重试，禁止覆盖旧内容或跳过未写入的字节。
    const r = row(p),
      bytes = p.content;
    if (
      r.digest ||
      !(bytes instanceof Uint8Array) ||
      !bytes.length ||
      bytes.length > 262144 ||
      !Number.isSafeInteger(p.offset) ||
      p.offset < 0
    )
      fail();
    const hash = digest(bytes);
    if (p.offset < r.written) {
      const old = db.prepare(sql.chunk).get(r.token, p.offset);
      if (!old || old.content.length !== bytes.length || old.digest !== hash) fail();
      return r.written;
    }
    if (p.offset !== r.written || r.written + bytes.length > r.size) fail();
    db.prepare(sql.append).run(r.token, p.offset, bytes, hash);
    db.prepare(sql.advance).run(bytes.length, r.token, p.offset);
    return r.written + bytes.length;
  });
  const seal = db.transaction((p) => {
    // 逐块校验摘要与 UTF-8，文件大小不影响封存时的峰值内存。
    const r = row(p);
    if (r.digest) return record(r);
    if (r.written !== r.size) fail();
    const a = attachment(JSON.parse(r.metadata_json)),
      hash = createHash("sha256"),
      decoder = a.kind === "text" ? new TextDecoder("utf-8", { fatal: true }) : null;
    let offset = 0;
    for (const c of db.prepare(sql.chunks).iterate(r.token)) {
      if (
        c.offset !== offset ||
        offset + c.content.length > r.size ||
        digest(c.content) !== c.digest
      )
        fail();
      hash.update(c.content);
      decoder?.decode(c.content, { stream: true });
      offset += c.content.length;
    }
    if (offset !== r.size) fail();
    decoder?.decode();
    db.prepare(sql.seal).run(hash.digest("hex"), r.token);
    return record(row(p));
  });
  const save = db.transaction((p) => {
    // 保存完整引用集合；CAS 或预算失败会连同旧资源回收一起回滚。
    if (
      !Array.isArray(p.resources) ||
      p.resources.length > 1500 ||
      new Set(p.resources).size !== p.resources.length
    )
      fail();
    const project = p.definition?.projectId,
      scoped = { source: p.source, scheduleId: p.scheduleId, projectId: project };
    scope(scoped);
    const refs = p.definition?.prompt?.attachments;
    if (
      !Array.isArray(refs) ||
      refs.length !== p.resources.length ||
      new Set(refs.map((r) => r.id)).size !== refs.length
    )
      fail();
    const ids = new Set(refs.map((r) => r.id));
    let images = 0,
      imageBytes = 0,
      fileBytes = 0;
    for (const token of p.resources) {
      const r = row({ ...scoped, token });
      const a = attachment(JSON.parse(r.metadata_json));
      if (!r.digest || !ids.delete(a.id)) fail();
      if (a.kind === "image") {
        images++;
        imageBytes += a.size;
      } else fileBytes += a.size;
    }
    if (ids.size || images > 20 || imageBytes > 52428800 || fileBytes > 52428800) fail();
    const plan = plans["acp.plan.set"](p);
    if (!plan) return null;
    db.prepare(sql.prune).run(p.source, p.scheduleId, JSON.stringify(p.resources));
    for (const token of p.resources)
      db.prepare(sql.bind).run(plan.revision, ...key({ ...scoped, token }));
    return plan;
  });
  return {
    "acp.resource.begin": (p) => begin.immediate(p),
    "acp.resource.append": (p) => append.immediate(p),
    "acp.resource.seal": (p) => seal.immediate(p),
    "acp.resource.chunk": chunk,
    "acp.resource.abort": (p) => db.prepare(sql.abort).run(...key(p)).changes > 0,
    "acp.resource.list": (p) => {
      const s = scope(p);
      if (!Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 1) fail();
      return db
        .prepare(sql.list)
        .all(...s, p.expectedRevision)
        .map(record);
    },
    "acp.plan.save": (p) => save.immediate(p),
  };
}
