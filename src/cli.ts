#!/usr/bin/env node

import { runCli } from "./cli-command.js";

process.exitCode = await runCli(process.argv.slice(2));
