#!/usr/bin/env node
/**
 * @module index
 * Entry point of the `ldesk` binary. Stub until the CLI is wired up.
 */
import { createRequire } from "node:module";
import { BIN_NAME } from "./constants.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

process.stdout.write(`${BIN_NAME} ${pkg.version}\n`);
