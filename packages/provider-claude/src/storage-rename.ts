import { rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

/** Preserve atomic replacement while Windows readers or scanners release their handles. */
export async function renameStorageFile(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        attempt === 7 ||
        !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")
      )
        throw error;
      await delay(25 * 2 ** attempt);
    }
  }
}
