import { appendFile, mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { extractCodexTextSkills, readCodexTranscriptTurnSkills } from "./codex-transcript.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Codex transcript Skills", () => {
  it("extracts native linked and expanded Skill text", () => {
    expect(
      extractCodexTextSkills(
        "[$superwork:superwork-start](/Users/test/skills/superwork-start/SKILL.md) 阅读项目",
      ),
    ).toEqual({
      skills: [{ name: "superwork:superwork-start" }],
      text: "阅读项目",
    });
    expect(
      extractCodexTextSkills(
        [
          "<skill>",
          "<name>superwork:superwork-start</name>",
          "<path>/Users/test/skills/superwork-start/SKILL.md</path>",
          "Skill instructions",
          "</skill>",
        ].join("\n"),
      ),
    ).toEqual({
      skills: [{ name: "superwork:superwork-start" }],
      text: "",
    });
  });

  it("restores Skills filtered from thread/read using the Codex rollout transcript", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codexly-codex-home-"));
    temporaryDirectories.push(codexHome);
    const sessionDirectory = join(codexHome, "sessions", "2026", "07", "27");
    await mkdir(sessionDirectory, { recursive: true });
    const threadId = "019fa2cd-e2fa-7fb3-8ecd-c7d56cd26383";
    const transcriptPath = join(sessionDirectory, `rollout-2026-07-27T17-00-29-${threadId}.jsonl`);
    const transcriptEntry = {
      payload: {
        content: [
          {
            text: [
              "<skill>",
              "<name>superwork:superwork-start</name>",
              "<path>/Users/test/skills/superwork-start/SKILL.md</path>",
              "Skill instructions",
              "</skill>",
            ].join("\n"),
            type: "input_text",
          },
        ],
        internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
        role: "user",
        type: "message",
      },
      type: "response_item",
    };
    await writeFile(transcriptPath, `${JSON.stringify(transcriptEntry)}\n`, "utf8");

    const skillsByTurnId = await readCodexTranscriptTurnSkills(threadId, codexHome);

    expect(skillsByTurnId.get("turn-1")).toEqual(["superwork:superwork-start"]);
  });

  it("reuses parsed Skills when transcript metadata is unchanged", async () => {
    const { codexHome, threadId, transcriptPath } = await createTranscriptFixture("turn-1");
    const fixedTime = new Date("2026-07-27T17:00:29.000Z");
    await utimes(transcriptPath, fixedTime, fixedTime);
    const originalStats = await stat(transcriptPath);

    const firstRead = await readCodexTranscriptTurnSkills(threadId, codexHome);
    const invalidContent = "x".repeat(originalStats.size - 1) + "\n";
    await writeFile(transcriptPath, invalidContent, "utf8");
    await utimes(transcriptPath, originalStats.atime, originalStats.mtime);

    const secondRead = await readCodexTranscriptTurnSkills(threadId, codexHome);

    expect(firstRead.get("turn-1")).toEqual(["superwork:superwork-start"]);
    expect(secondRead).toBe(firstRead);
    expect(secondRead.get("turn-1")).toEqual(["superwork:superwork-start"]);
  });

  it("parses only newly appended complete transcript lines", async () => {
    const { codexHome, threadId, transcriptPath } = await createTranscriptFixture("turn-1");
    await readCodexTranscriptTurnSkills(threadId, codexHome);
    const appendedEntry = createTranscriptEntry("turn-2");
    const appendedLine = `${JSON.stringify(appendedEntry)}\n`;
    const splitIndex = Math.floor(appendedLine.length / 2);

    await appendFile(transcriptPath, appendedLine.slice(0, splitIndex), "utf8");
    const partialRead = await readCodexTranscriptTurnSkills(threadId, codexHome);
    await appendFile(transcriptPath, appendedLine.slice(splitIndex), "utf8");
    const completeRead = await readCodexTranscriptTurnSkills(threadId, codexHome);

    expect(partialRead.has("turn-2")).toBe(false);
    expect(completeRead.get("turn-1")).toEqual(["superwork:superwork-start"]);
    expect(completeRead.get("turn-2")).toEqual(["superwork:superwork-start"]);
  });

  it("resumes parsing after an oversized incomplete transcript line", async () => {
    const { codexHome, threadId, transcriptPath } = await createTranscriptFixture("turn-1");
    await appendFile(transcriptPath, "x".repeat(1024 * 1024 + 1), "utf8");

    const oversizedRead = await readCodexTranscriptTurnSkills(threadId, codexHome);
    await appendFile(
      transcriptPath,
      `\n${JSON.stringify(createTranscriptEntry("turn-2"))}\n`,
      "utf8",
    );
    const resumedRead = await readCodexTranscriptTurnSkills(threadId, codexHome);

    expect(oversizedRead.has("turn-2")).toBe(false);
    expect(resumedRead.get("turn-1")).toEqual(["superwork:superwork-start"]);
    expect(resumedRead.get("turn-2")).toEqual(["superwork:superwork-start"]);
  });

  it("bounds cached transcript turns per file", async () => {
    const { codexHome, threadId, transcriptPath } = await createTranscriptFixture("turn-0");
    const entries = Array.from({ length: 2_048 }, (_, index) =>
      JSON.stringify(createTranscriptEntry(`turn-${String(index + 1)}`)),
    );
    await appendFile(transcriptPath, `${entries.join("\n")}\n`, "utf8");

    const skillsByTurnId = await readCodexTranscriptTurnSkills(threadId, codexHome);

    expect(skillsByTurnId).toHaveLength(2_048);
    expect(skillsByTurnId.has("turn-0")).toBe(false);
    expect(skillsByTurnId.get("turn-2048")).toEqual(["superwork:superwork-start"]);
  });

  it("bounds cached transcript Skill name bytes per file", async () => {
    const skillName = "s".repeat(128 * 1_024);
    const { codexHome, threadId, transcriptPath } = await createTranscriptFixture(
      "turn-0",
      skillName,
    );
    const entries = Array.from({ length: 8 }, (_, index) =>
      JSON.stringify(createTranscriptEntry(`turn-${String(index + 1)}`, skillName)),
    );
    await appendFile(transcriptPath, `${entries.join("\n")}\n`, "utf8");

    const skillsByTurnId = await readCodexTranscriptTurnSkills(threadId, codexHome);
    const retainedSkillBytes = [...skillsByTurnId.values()].reduce(
      (total, names) => total + names.reduce((sum, name) => sum + Buffer.byteLength(name), 0),
      0,
    );

    expect(retainedSkillBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(skillsByTurnId.has("turn-0")).toBe(false);
    expect(skillsByTurnId.get("turn-8")).toEqual([skillName]);
  });
});

function createTranscriptEntry(turnId: string, skillName = "superwork:superwork-start"): object {
  return {
    payload: {
      content: [
        {
          text: [
            "<skill>",
            `<name>${skillName}</name>`,
            "<path>/Users/test/skills/superwork-start/SKILL.md</path>",
            "Skill instructions",
            "</skill>",
          ].join("\n"),
          type: "input_text",
        },
      ],
      internal_chat_message_metadata_passthrough: { turn_id: turnId },
      role: "user",
      type: "message",
    },
    type: "response_item",
  };
}

async function createTranscriptFixture(
  turnId: string,
  skillName = "superwork:superwork-start",
): Promise<{
  codexHome: string;
  threadId: string;
  transcriptPath: string;
}> {
  const codexHome = await mkdtemp(join(tmpdir(), "codexly-codex-home-"));
  temporaryDirectories.push(codexHome);
  const sessionDirectory = join(codexHome, "sessions", "2026", "07", "27");
  await mkdir(sessionDirectory, { recursive: true });
  const threadId = crypto.randomUUID();
  const transcriptPath = join(sessionDirectory, `rollout-2026-07-27T17-00-29-${threadId}.jsonl`);
  await writeFile(
    transcriptPath,
    `${JSON.stringify(createTranscriptEntry(turnId, skillName))}\n`,
    "utf8",
  );
  return { codexHome, threadId, transcriptPath };
}
