// Builds the filter engine off the main thread. Parsing uBlock Origin's lists takes most of a second, and in the main
// process every page request would wait for it. See content-blocker.mjs.
//
// SPDX-License-Identifier: BSD-3-Clause
import { parentPort, workerData } from "node:worker_threads";

import { buildEngine } from "./content-blocker.mjs";

const built = buildEngine(workerData.texts, workerData.resources);
parentPort.postMessage(built, [built.bytes.buffer]);
