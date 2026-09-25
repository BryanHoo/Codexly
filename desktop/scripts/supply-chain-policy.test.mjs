import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const rootUrl = new URL("../", import.meta.url);
const workflowsUrl = new URL(".github/workflows/", rootUrl);

async function readProjectFile(path) {
  return readFile(new URL(path, rootUrl), "utf8");
}

void test("GitHub Actions should be pinned to full commit SHAs", async () => {
  const workflowFiles = (await readdir(workflowsUrl)).filter((name) => /\.ya?ml$/.test(name));

  for (const workflowFile of workflowFiles) {
    const workflow = await readFile(new URL(workflowFile, workflowsUrl), "utf8");
    const actionReferences = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)];

    for (const [, actionReference] of actionReferences) {
      // 本地 Action 和复用工作流由仓库提交固定，不需要远程 SHA。
      if (actionReference.startsWith("./")) {
        continue;
      }

      assert.match(
        actionReference,
        /^[^@]+@[0-9a-f]{40}$/,
        `${workflowFile} contains an unpinned Action: ${actionReference}`,
      );
    }
  }
});

void test("Git dependencies should use auditable commit revisions", async () => {
  const cargoManifest = await readProjectFile("src-tauri/Cargo.toml");
  const nspanelDependency = cargoManifest.match(/^tauri-nspanel\s*=\s*\{([^}]+)\}/m)?.[1];

  assert.ok(nspanelDependency, "tauri-nspanel dependency is missing");
  assert.doesNotMatch(nspanelDependency, /\bbranch\s*=/);
  assert.match(nspanelDependency, /\brev\s*=\s*"[0-9a-f]{40}"/);
});

void test("quality CI should audit production dependencies", async () => {
  const qualityWorkflow = await readProjectFile(".github/workflows/quality.yml");

  assert.match(qualityWorkflow, /run:\s*pnpm audit --prod\b/);
  assert.match(qualityWorkflow, /uses:\s*EmbarkStudios\/cargo-deny-action@[0-9a-f]{40}/);
  assert.match(qualityWorkflow, /command:\s*check advisories bans licenses sources/);
});

void test("quality CI should install every configured browser engine", async () => {
  const qualityWorkflow = await readProjectFile(".github/workflows/quality.yml");

  assert.match(
    qualityWorkflow,
    /pnpm exec playwright install --with-deps chromium webkit/,
  );
});

void test("stable releases should publish signed updater artifacts directly", async () => {
  const releaseWorkflow = await readProjectFile(".github/workflows/release.yml");

  assert.match(releaseWorkflow, /releaseDraft:\s*false/);
  assert.ok(releaseWorkflow.includes("prerelease: ${{ contains(steps.build-version.outputs.version, '-') }}"));
  assert.match(
    releaseWorkflow,
    /TAURI_SIGNING_PRIVATE_KEY:\s*\$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /uploadUpdaterJson:\s*\$\{\{ matrix\.uploadUpdaterArtifacts \}\}/,
  );
  assert.match(
    releaseWorkflow,
    /uploadUpdaterSignatures:\s*\$\{\{ matrix\.uploadUpdaterArtifacts \}\}/,
  );

  const unsignedBuilds = [...releaseWorkflow.matchAll(/^\s*args:\s*(.*--no-sign.*)$/gm)].map(
    ([, args]) => args,
  );
  assert.deepEqual(unsignedBuilds, ["--no-bundle --no-sign --ci"]);
});

void test("cargo-deny should enforce dependency policy", async () => {
  const denyConfig = await readProjectFile("deny.toml");

  assert.match(denyConfig, /\[bans\][\s\S]*multiple-versions\s*=\s*"(?:warn|deny)"/);
  assert.match(denyConfig, /\[licenses\][\s\S]*allow\s*=/);
  assert.match(denyConfig, /\[sources\][\s\S]*unknown-registry\s*=\s*"deny"/);
  assert.match(denyConfig, /\[sources\][\s\S]*unknown-git\s*=\s*"deny"/);
});
