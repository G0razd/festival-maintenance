import { createServer } from "node:http";
import { classifyEvent, tokenMatches } from "./gitlab.js";

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const STATUS_PATH = "/_status/status.json";
const HOOK_PATH = "/hooks/gitlab";

class TooLarge extends Error {}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new TooLarge());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function publicDeploy(entry) {
  return {
    receivedAt: entry.receivedAt,
    kind: entry.kind,
    project: entry.project,
    branch: entry.branch,
    sha: entry.sha ? entry.sha.slice(0, 8) : null,
    author: entry.author,
    pipelineStatus: entry.pipelineStatus ?? null,
    status: entry.status,
    deckhand: entry.deckhand ?? null,
    deployedWith: entry.deployedWith ?? null,
    finishedAt: entry.finishedAt ?? null,
  };
}

export function createApp({ gitlab, checker, log, deployer, now = () => Date.now() }) {
  async function handleHook(req, res) {
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" }, { Allow: "POST" });
    if (!tokenMatches(gitlab.token, req.headers["x-gitlab-token"])) return send(res, 401, { error: "invalid token" });

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (error) {
      if (error instanceof TooLarge) return send(res, 413, { error: "payload too large" });
      return send(res, 400, { error: "invalid JSON" });
    }

    const decision = classifyEvent(req.headers["x-gitlab-event"], body, gitlab);
    if (decision.action === "ignore") return send(res, 200, { result: "ignored", reason: decision.reason });

    const { kind, project, branch, sha, author, pipelineStatus } = decision.event;
    const entry = log.add({
      kind,
      project,
      branch,
      sha,
      author,
      pipelineStatus: pipelineStatus ?? null,
      status: decision.action === "deploy" ? "queued" : "recorded",
    });
    if (decision.action === "deploy") deployer.enqueue(entry.id);
    return send(res, 202, { result: entry.status });
  }

  function handleStatus(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" }, { Allow: "GET, HEAD" });
    const { checkedAt, results } = checker.current();
    return send(res, 200, {
      generatedAt: new Date(now()).toISOString(),
      checkedAt,
      checks: results,
      deployOn: gitlab.deployOn,
      deploys: log.list().map(publicDeploy),
    });
  }

  return async function handle(req, res) {
    const path = new URL(req.url, "http://status.invalid").pathname;
    try {
      if (path === HOOK_PATH) return await handleHook(req, res);
      if (path === STATUS_PATH) return handleStatus(req, res);
      if (path === "/healthz") return send(res, 200, "ok");
      return send(res, 404, { error: "not found" });
    } catch (error) {
      console.error(`request failed: ${error.message}`);
      if (!res.headersSent) send(res, 500, { error: "internal error" });
    }
  };
}

export function startServer(app, port) {
  const server = createServer(app);
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
