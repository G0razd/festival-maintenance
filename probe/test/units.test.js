import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Checker } from "../src/checker.js";
import { DeployLog } from "../src/deploy-log.js";
import { tokenMatches } from "../src/gitlab.js";

test("tokenMatches accepts only the exact token", () => {
  assert.equal(tokenMatches("s3cret-token", "s3cret-token"), true);
  assert.equal(tokenMatches("s3cret-token", "s3cret-tokeN"), false);
  assert.equal(tokenMatches("s3cret-token", "s3cret"), false);
  assert.equal(tokenMatches("s3cret-token", undefined), false);
  assert.equal(tokenMatches("", ""), false);
});

test("the checker reports HTTP status, failures and the check time", async () => {
  const responses = {
    "https://site.test/": () => new Response("ok", { status: 200 }),
    "https://cms.test/server/ping": () => new Response("down", { status: 503 }),
    "https://archive.test/": () => {
      throw new TypeError("fetch failed");
    },
  };
  const checker = new Checker({
    checks: [
      { key: "site", url: "https://site.test/" },
      { key: "cms", url: "https://cms.test/server/ping" },
      { key: "archive", url: "https://archive.test/" },
    ],
    timeoutMs: 1000,
    fetch: async (url) => responses[url](),
    now: () => Date.parse("2026-10-20T14:00:00.000Z"),
  });

  await checker.run();
  const { checkedAt, results } = checker.current();

  assert.equal(checkedAt, "2026-10-20T14:00:00.000Z");
  assert.deepEqual(
    results.map(({ key, ok, status, error }) => [key, ok, status, error ?? null]),
    [
      ["site", true, 200, null],
      ["cms", false, 503, null],
      ["archive", false, null, "unreachable"],
    ],
  );
});

test("the deploy log keeps the newest ten and survives a restart", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "festival-status-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "deploys.json");
  const log = new DeployLog(file);

  for (let index = 0; index < 12; index += 1) log.add({ sha: `sha-${index}`, status: "recorded" });
  await log.persist();
  const reloaded = new DeployLog(file);
  await reloaded.load();

  assert.equal(JSON.parse(await readFile(file, "utf8")).length, 10);
  assert.deepEqual(
    [reloaded.list().length, reloaded.list()[0].sha, reloaded.list()[9].sha],
    [10, "sha-11", "sha-2"],
  );
});

test("entries a restart interrupted are marked so, finished ones are kept", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "festival-status-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "deploys.json");
  await writeFile(
    file,
    JSON.stringify([
      { id: "1", status: "queued" },
      { id: "2", status: "accepted" },
      { id: "3", status: "deploying" },
      { id: "4", status: "success" },
      { id: "5", status: "coalesced" },
    ]),
  );
  const log = new DeployLog(file);

  await log.load();

  assert.deepEqual(
    log.list().map((entry) => entry.status),
    ["interrupted", "interrupted", "interrupted", "success", "coalesced"],
  );
});
