import { readFileSync } from "node:fs";
import { DeployLog } from "../src/deploy-log.js";
import { Deployer } from "../src/deployer.js";
import { createApp, startServer } from "../src/server.js";

export const HOOK_TOKEN = "gitlab-test-token";
export const DECKHAND_SECRET = "deckhand-test-secret";
export const API_TOKEN = "dh_test-api-token";

export const gitlab = { token: HOOK_TOKEN, project: "lemma/web/festival-26", branch: "deckhand", deployOn: "push" };

export const deckhand = {
  hookUrl: "https://deckhand.test/api/webhooks/gitlab",
  hookSecret: DECKHAND_SECRET,
  repoUrl: "https://gitlab.fi.muni.cz/lemma/web/festival-26.git",
  apiUrl: "https://deckhand.test",
  apiToken: "",
  projectId: "",
  serviceId: "",
};

const timing = { debounceMs: 60_000, retryDelayMs: 0, requestTimeoutMs: 1_000, pollMs: 0, buildStartTimeoutMs: 60_000, trackTimeoutMs: 60_000 };

export const ACCEPTED = { status: 202, body: { message: "Accepted redeployment for 1 service(s)", services: ["site"] } };

export function pushPayload(overrides = {}) {
  const payload = JSON.parse(readFileSync(new URL("./fixtures/push-deckhand.json", import.meta.url), "utf8"));
  if (overrides.sha) {
    payload.after = overrides.sha;
    payload.checkout_sha = overrides.sha;
    payload.commits[0].id = overrides.sha;
  }
  if (overrides.ref) payload.ref = overrides.ref;
  if (overrides.project) payload.project.path_with_namespace = overrides.project;
  return payload;
}

export function pipelinePayload(status) {
  return {
    object_kind: "pipeline",
    object_attributes: { id: 31, ref: "deckhand", tag: false, sha: "24dd291f6b7f63da81c612860e2c169875242d9f", status },
    user: { name: "Festival Pusher" },
    project: { path_with_namespace: "lemma/web/festival-26" },
    commit: { id: "24dd291f6b7f63da81c612860e2c169875242d9f", author: { name: "Festival Editor" } },
  };
}

function fakeScheduler() {
  const scheduler = {
    pending: new Map(),
    next: 1,
    set(fn) {
      const id = scheduler.next++;
      scheduler.pending.set(id, fn);
      return id;
    },
    clear(id) {
      scheduler.pending.delete(id);
    },
    fire() {
      const due = [...scheduler.pending.values()];
      scheduler.pending.clear();
      for (const fn of due) fn();
    },
  };
  return scheduler;
}

function scriptedFetch(responses) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected call to ${url}`);
    if (next instanceof Error) throw next;
    if (typeof next === "function") return next();
    return new Response(JSON.stringify(next.body ?? {}), { status: next.status });
  };
  return { calls, fetch };
}

export async function harness(t, { responses = [], deckhandOverrides = {}, gitlabOverrides = {} } = {}) {
  const config = { ...gitlab, ...gitlabOverrides };
  const log = new DeployLog(null);
  const scheduler = fakeScheduler();
  const remote = scriptedFetch(responses);
  const deployer = new Deployer({
    log,
    deckhand: { ...deckhand, ...deckhandOverrides },
    gitlab: config,
    timing,
    fetch: remote.fetch,
    setTimer: scheduler.set,
    clearTimer: scheduler.clear,
    sleep: async () => {},
  });
  const checker = {
    current: () => ({
      checkedAt: "2026-10-20T14:00:00.000Z",
      results: [{ key: "site", url: "https://festival-26.deckhand.lemmaweb.com/", ok: true, status: 200, ms: 40 }],
    }),
  };
  const server = await startServer(createApp({ gitlab: config, checker, log, deployer }), 0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function post(body, { token = HOOK_TOKEN, event = "Push Hook" } = {}) {
    const headers = { "Content-Type": "application/json", "X-Gitlab-Event": event };
    if (token !== null) headers["X-Gitlab-Token"] = token;
    return fetch(`${base}/hooks/gitlab`, { method: "POST", headers, body: JSON.stringify(body) });
  }

  async function settle() {
    scheduler.fire();
    while (deployer.running) await deployer.running;
  }

  return { base, log, scheduler, remote, deployer, post, settle };
}
