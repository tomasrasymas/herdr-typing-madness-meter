// Action: reset all stats. A running HUD holds stats in memory, so it is
// asked to reset through a flag file it checks about once a second.

import fs from "node:fs";
import path from "node:path";
import { stateDir } from "../config.ts";
import { resetStats } from "../store.ts";

fs.mkdirSync(stateDir(), { recursive: true });
fs.writeFileSync(path.join(stateDir(), "reset-request"), String(Date.now()));
resetStats();
console.log("typing stats reset");
