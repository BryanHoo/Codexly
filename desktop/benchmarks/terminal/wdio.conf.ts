import { config as base } from "../../wdio.conf.js";

export const config = { ...base, specs: ["./terminal-native.spec.ts"], mochaOpts: { timeout: 480000, ui: "bdd" as const } };
