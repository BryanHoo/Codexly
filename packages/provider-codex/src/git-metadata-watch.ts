import { lstat, readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { AgentTaskScope } from "@codexly/core";

import type { CodexRpcClient } from "./agent-provider-base.js";
import type { CodexProviderLogger } from "./agent-provider-logger.js";
import { SUPPORTED_CODEX_VERSION } from "./binary.js";

const DEFAULT_CHANGE_DEBOUNCE_MS = 100;
const MAX_GIT_REPOSITORIES_PER_ROOT = 32;
export const MAX_CODEX_GIT_METADATA_WATCHES = 128;

type WatchClient = Pick<CodexRpcClient, "request">;

type WatchDescriptor = Readonly<{
  path: string;
  refreshTopology: boolean;
}>;

type WatchRegistration = WatchDescriptor & Readonly<{ watchId: string }>;

interface PendingRootChange {
  refreshTopology: boolean;
  timer: ReturnType<typeof setTimeout>;
}

interface ProjectWatchState {
  operation: Promise<void>;
  pendingRoots: Map<string, PendingRootChange>;
  registrationsByRoot: Map<string, Map<string, WatchRegistration>>;
  released: boolean;
  scope: AgentTaskScope;
}

type WatchOwner = Readonly<{
  projectId: string;
  refreshTopology: boolean;
  rootPath: string;
}>;

type GitMetadata = Readonly<{
  commonDir: string;
  gitDir: string;
}>;

export interface CodexGitMetadataWatchServiceOptions {
  debounceMs?: number;
  logger: CodexProviderLogger;
  maxWatchCount?: number;
  onChanged: (projectId: string, rootPath: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function resolveGitMetadata(repositoryRoot: string): Promise<GitMetadata | undefined> {
  const dotGitPath = join(repositoryRoot, ".git");
  let dotGitStat;
  try {
    dotGitStat = await lstat(dotGitPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let gitDir: string;
  if (dotGitStat.isDirectory()) {
    gitDir = dotGitPath;
  } else if (dotGitStat.isFile()) {
    const content = (await readFile(dotGitPath, "utf8")).trim();
    const match = /^gitdir:\s*(.+)$/iu.exec(content);
    if (match?.[1] === undefined) return undefined;
    gitDir = resolve(dirname(dotGitPath), match[1]);
  } else {
    return undefined;
  }

  const commonDirValue = (await readOptionalText(join(gitDir, "commondir")))?.trim();
  const commonDir =
    commonDirValue === undefined || commonDirValue === ""
      ? gitDir
      : resolve(gitDir, commonDirValue);
  return { commonDir, gitDir };
}

async function discoverRepositoryRoots(rootPath: string): Promise<readonly string[]> {
  if (await pathExists(join(rootPath, ".git"))) return [rootPath];
  let entries;
  try {
    entries = (await readdir(rootPath, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .toSorted((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const repositories: string[] = [];
  for (const entry of entries) {
    const candidate = join(rootPath, entry.name);
    if (await pathExists(join(candidate, ".git"))) repositories.push(candidate);
    if (repositories.length >= MAX_GIT_REPOSITORIES_PER_ROOT) break;
  }
  return repositories;
}

function resolveHeadRef(commonDir: string, head: string | undefined): string | undefined {
  const refName = /^ref:\s*(refs\/.+)$/u.exec(head?.trim() ?? "")?.[1];
  if (refName === undefined || isAbsolute(refName)) return undefined;
  const refPath = resolve(commonDir, refName);
  const relativePath = relative(commonDir, refPath);
  return relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)
    ? undefined
    : refPath;
}

async function buildWatchDescriptors(rootPath: string): Promise<readonly WatchDescriptor[]> {
  const descriptors = new Map<string, WatchDescriptor>();
  const add = (path: string, refreshTopology = false) => {
    const current = descriptors.get(path);
    descriptors.set(path, {
      path,
      refreshTopology: refreshTopology || current?.refreshTopology === true,
    });
  };
  for (const repositoryRoot of await discoverRepositoryRoots(rootPath)) {
    const metadata = await resolveGitMetadata(repositoryRoot);
    if (metadata === undefined) continue;
    add(join(metadata.gitDir, "HEAD"), true);
    add(join(metadata.gitDir, "index"));
    add(join(metadata.commonDir, "packed-refs"));
    const currentRef = resolveHeadRef(
      metadata.commonDir,
      await readOptionalText(join(metadata.gitDir, "HEAD")),
    );
    if (currentRef !== undefined) add(currentRef);
  }
  return [...descriptors.values()];
}

export class CodexGitMetadataWatchService {
  readonly #client: WatchClient;
  readonly #debounceMs: number;
  readonly #logger: CodexProviderLogger;
  readonly #maxWatchCount: number;
  readonly #onChanged: (projectId: string, rootPath: string) => void;
  readonly #projects = new Map<string, ProjectWatchState>();
  readonly #watchOwners = new Map<string, WatchOwner>();
  #nextWatchId = 1;
  #watchSlotsInUse = 0;

  public constructor(client: WatchClient, options: CodexGitMetadataWatchServiceOptions) {
    this.#client = client;
    this.#debounceMs = options.debounceMs ?? DEFAULT_CHANGE_DEBOUNCE_MS;
    this.#logger = options.logger;
    this.#maxWatchCount = options.maxWatchCount ?? MAX_CODEX_GIT_METADATA_WATCHES;
    this.#onChanged = options.onChanged;
    if (!Number.isSafeInteger(this.#maxWatchCount) || this.#maxWatchCount <= 0) {
      throw new RangeError("Codex Git metadata maxWatchCount must be a positive integer");
    }
  }

  public async watchProject(scope: AgentTaskScope): Promise<void> {
    const current = this.#projects.get(scope.id);
    if (current !== undefined) {
      await current.operation;
      return;
    }
    const state: ProjectWatchState = {
      operation: Promise.resolve(),
      pendingRoots: new Map(),
      registrationsByRoot: new Map(),
      released: false,
      scope,
    };
    this.#projects.set(scope.id, state);
    state.operation = this.#reconcileProject(state);
    await state.operation;
  }

  public receiveNotification(method: string, params: unknown): void {
    if (
      method !== "fs/changed" ||
      !isRecord(params) ||
      typeof params["watchId"] !== "string" ||
      !Array.isArray(params["changedPaths"]) ||
      !params["changedPaths"].every((path) => typeof path === "string")
    ) {
      return;
    }
    const owner = this.#watchOwners.get(params["watchId"]);
    const state = owner === undefined ? undefined : this.#projects.get(owner.projectId);
    if (owner === undefined || state === undefined || state.released) return;

    const pending = state.pendingRoots.get(owner.rootPath);
    if (pending !== undefined) {
      pending.refreshTopology ||= owner.refreshTopology;
      return;
    }
    const change: PendingRootChange = {
      refreshTopology: owner.refreshTopology,
      timer: setTimeout(() => {
        state.pendingRoots.delete(owner.rootPath);
        state.operation = state.operation
          .catch(() => undefined)
          .then(async () => {
            if (state.released) return;
            this.#onChanged(owner.projectId, owner.rootPath);
            if (change.refreshTopology) await this.#reconcileRoot(state, owner.rootPath);
          })
          .catch(() => {
            this.#warn("git_metadata_watch_reconcile_failed", owner.projectId);
          });
      }, this.#debounceMs),
    };
    state.pendingRoots.set(owner.rootPath, change);
  }

  public async releaseProject(projectId: string): Promise<void> {
    const state = this.#projects.get(projectId);
    if (state === undefined) return;
    this.#projects.delete(projectId);
    state.released = true;
    for (const pending of state.pendingRoots.values()) clearTimeout(pending.timer);
    state.pendingRoots.clear();
    await state.operation.catch(() => undefined);
    const registrations = [...state.registrationsByRoot.values()].flatMap((entries) => [
      ...entries.values(),
    ]);
    state.registrationsByRoot.clear();
    await Promise.all(registrations.map((registration) => this.#unwatch(registration.watchId)));
  }

  async #reconcileProject(state: ProjectWatchState): Promise<void> {
    for (const rootPath of state.scope.runtimeWorkspaceRoots) {
      if (state.released) return;
      await this.#reconcileRoot(state, rootPath);
    }
  }

  async #reconcileRoot(state: ProjectWatchState, rootPath: string): Promise<void> {
    let desired: readonly WatchDescriptor[];
    try {
      desired = await buildWatchDescriptors(rootPath);
    } catch {
      this.#warn("git_metadata_watch_discovery_failed", state.scope.id);
      return;
    }
    const registrations =
      state.registrationsByRoot.get(rootPath) ?? new Map<string, WatchRegistration>();
    state.registrationsByRoot.set(rootPath, registrations);
    const desiredPaths = new Set(desired.map((descriptor) => descriptor.path));

    // 先补齐新路径再释放旧路径，避免 HEAD 切换时出现监听空窗。
    for (const descriptor of desired) {
      if (state.released || registrations.has(descriptor.path)) continue;
      if (this.#watchSlotsInUse >= this.#maxWatchCount) break;
      const watchId = `codexly-git-${String(this.#nextWatchId++)}`;
      // 先预留全局槽位，避免多个 Project 并发注册时突破连接级预算。
      this.#watchSlotsInUse += 1;
      try {
        const response = await this.#client.request("fs/watch", {
          path: descriptor.path,
          watchId,
        });
        if (!isRecord(response) || typeof response["path"] !== "string") {
          throw new TypeError("fs/watch response path is invalid");
        }
      } catch {
        this.#watchSlotsInUse -= 1;
        this.#warn("git_metadata_watch_register_failed", state.scope.id);
        continue;
      }
      if (this.#projects.get(state.scope.id) !== state) {
        await this.#unwatch(watchId);
        continue;
      }
      const registration = { ...descriptor, watchId };
      registrations.set(descriptor.path, registration);
      this.#watchOwners.set(watchId, {
        projectId: state.scope.id,
        refreshTopology: descriptor.refreshTopology,
        rootPath,
      });
    }

    for (const [path, registration] of registrations) {
      if (desiredPaths.has(path)) continue;
      registrations.delete(path);
      await this.#unwatch(registration.watchId);
    }
  }

  async #unwatch(watchId: string): Promise<void> {
    const owner = this.#watchOwners.get(watchId);
    this.#watchOwners.delete(watchId);
    this.#watchSlotsInUse = Math.max(0, this.#watchSlotsInUse - 1);
    try {
      await this.#client.request("fs/unwatch", { watchId });
    } catch {
      this.#warn("git_metadata_watch_unregister_failed", owner?.projectId ?? null);
    }
  }

  #warn(diagnosticCode: string, projectId: string | null): void {
    this.#logger.warn(
      { codexVersion: SUPPORTED_CODEX_VERSION, diagnosticCode, projectId },
      "Codex Git metadata watch failed",
    );
  }
}
