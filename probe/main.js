import { Checker } from "./src/checker.js";
import { readConfig } from "./src/config.js";
import { DeployLog } from "./src/deploy-log.js";
import { Deployer } from "./src/deployer.js";
import { createApp, startServer } from "./src/server.js";

const config = readConfig();
const log = new DeployLog(config.dataFile);
await log.load();

const checker = new Checker({ checks: config.checks, timeoutMs: config.checkTimeoutMs });
const deployer = new Deployer({ log, deckhand: config.deckhand, gitlab: config.gitlab, timing: config.deploy });
const server = await startServer(createApp({ gitlab: config.gitlab, checker, log, deployer }), config.port);

void checker.run();
const interval = setInterval(() => void checker.run(), config.checkIntervalMs);

if (!config.gitlab.token) console.warn("GITLAB_HOOK_TOKEN is not set: every hook call answers 401");
console.log(`festival-status probe on :${config.port}, deploys on ${config.gitlab.deployOn} to ${config.gitlab.project}@${config.gitlab.branch}`);

process.on("SIGTERM", () => {
  clearInterval(interval);
  server.close(() => process.exit(0));
});
