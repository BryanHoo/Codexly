export type CodexRuntimeAvailabilityStatus =
  | "compatible"
  | "failed"
  | "incompatible"
  | "missing";

export type CodexRuntimeAvailability = Readonly<{
  detectedVersion: string | null;
  requiredVersion: string;
  status: CodexRuntimeAvailabilityStatus;
}>;

export type CodexRuntimeInstallProgress = Readonly<{
  currentVersion: string | null;
  downloadedBytes: number;
  phase: "downloading" | "failed" | "installing" | "preparing" | "ready";
  sequence: number;
  targetVersion: string;
  totalBytes: number | null;
}>;
