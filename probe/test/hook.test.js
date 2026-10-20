import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCEPTED,
  API_TOKEN,
  DECKHAND_SECRET,
  HOOK_TOKEN,
  harness,
  pipelinePayload,
  pushPayload,
} from "./helpers.js";

const SHA_A = "aaaaaaaa11111111111111111111111111111111";
const SHA_B = "bbbbbbbb22222222222222222222222222222222";
const SHA_C = "cccccccc33333333333333333333333333333333";

test("a wrong token answers 401 and records nothing", async (t) => {
  const { post, log, scheduler } = await harness(t);

  const wrong = await post(pushPayload(), { token: "not-the-token" });
  const missing = await post(pushPayload(), { token: null });

  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(log.list().length, 0);
  assert.equal(scheduler.pending.size, 0);
});

test("an unset hook token rejects every call", async (t) => {
  const { post, log } = await harness(t, { gitlabOverrides: { token: "" } });

  const response = await post(pushPayload(), { token: "" });

  assert.equal(response.status, 401);
  assert.equal(log.list().length, 0);
});

test("GET on the hook answers 405", async (t) => {
  const { base } = await harness(t);

  const response = await fetch(`${base}/hooks/gitlab`);

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST");
});

test("a push to another branch is ignored and deploys nothing", async (t) => {
  const { post, log, scheduler, remote } = await harness(t);

  const response = await post(pushPayload({ ref: "refs/heads/master" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { result: "ignored", reason: "branch" });
  assert.equal(log.list().length, 0);
  assert.equal(scheduler.pending.size, 0);
  assert.equal(remote.calls.length, 0);
});

test("a push to another project is ignored", async (t) => {
  const { post, log } = await harness(t);

  const response = await post(pushPayload({ project: "lemma/web/festival-25" }));

  assert.deepEqual(await response.json(), { result: "ignored", reason: "project" });
  assert.equal(log.list().length, 0);
});

test("a burst of pushes gives one deploy of the newest commit", async (t) => {
  const { post, log, remote, settle } = await harness(t, { responses: [ACCEPTED] });

  for (const sha of [SHA_A, SHA_B, SHA_C]) {
    const response = await post(pushPayload({ sha }));
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { result: "queued" });
  }
  await settle();

  assert.equal(remote.calls.length, 1);
  const [{ url, init }] = remote.calls;
  assert.equal(url, "https://deckhand.test/api/webhooks/gitlab");
  assert.equal(init.headers["X-Gitlab-Token"], DECKHAND_SECRET);
  assert.equal(init.headers["X-Gitlab-Event"], "Push Hook");
  const forwarded = JSON.parse(init.body);
  assert.equal(forwarded.ref, "refs/heads/deckhand");
  assert.equal(forwarded.checkout_sha, SHA_C);
  assert.equal(forwarded.project.git_http_url, "https://gitlab.fi.muni.cz/lemma/web/festival-26.git");

  const [newest, middle, oldest] = log.list();
  assert.equal(newest.sha, SHA_C);
  assert.equal(newest.status, "untracked");
  assert.equal(newest.deckhand, "202 Accepted redeployment for 1 service(s)");
  assert.equal(newest.author, "Festival Editor");
  assert.deepEqual([middle.status, middle.deployedWith], ["coalesced", "cccccccc"]);
  assert.deepEqual([oldest.status, oldest.deployedWith], ["coalesced", "cccccccc"]);
});

test("a push during a running deploy gives exactly one more deploy after it", async (t) => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const { post, remote, scheduler, deployer, settle, log } = await harness(t, {
    responses: [async () => {
      await held;
      return new Response(JSON.stringify(ACCEPTED.body), { status: 202 });
    }, ACCEPTED],
  });

  await post(pushPayload({ sha: SHA_A }));
  scheduler.fire();
  await post(pushPayload({ sha: SHA_B }));
  await post(pushPayload({ sha: SHA_C }));

  assert.equal(scheduler.pending.size, 0);
  release();
  await deployer.running;
  assert.equal(scheduler.pending.size, 1);
  await settle();

  assert.equal(remote.calls.length, 2);
  assert.equal(JSON.parse(remote.calls[1].init.body).checkout_sha, SHA_C);
  assert.deepEqual(
    log.list().map((entry) => [entry.sha, entry.status]),
    [
      [SHA_C, "untracked"],
      [SHA_B, "coalesced"],
      [SHA_A, "untracked"],
    ],
  );
});

test("a failed DeckHand call is retried once, then recorded as failed", async (t) => {
  const { post, remote, log, settle } = await harness(t, {
    responses: [{ status: 502, body: { message: "Bad Gateway" } }, { status: 502, body: { message: "Bad Gateway" } }],
  });

  await post(pushPayload());
  await settle();

  assert.equal(remote.calls.length, 2);
  const [entry] = log.list();
  assert.equal(entry.status, "failed");
  assert.equal(entry.deckhand, "502 Bad Gateway");
  assert.ok(entry.finishedAt);
});

test("a DeckHand outage on the first try is recovered by the retry", async (t) => {
  const { post, remote, log, settle } = await harness(t, { responses: [new TypeError("fetch failed"), ACCEPTED] });

  await post(pushPayload());
  await settle();

  assert.equal(remote.calls.length, 2);
  assert.equal(log.list()[0].status, "untracked");
});

test("DeckHand refusing the secret is not retried", async (t) => {
  const { post, remote, log, settle } = await harness(t, {
    responses: [{ status: 401, body: { message: "Webhook signature does not match any service for this repository" } }],
  });

  await post(pushPayload());
  await settle();

  assert.equal(remote.calls.length, 1);
  assert.equal(log.list()[0].status, "failed");
  assert.match(log.list()[0].deckhand, /^401 Webhook signature/);
});

test("DeckHand matching no service counts as failed", async (t) => {
  const { post, log, settle } = await harness(t, {
    responses: [{ status: 202, body: { message: "No matching services found for redeployment", services: [] } }],
  });

  await post(pushPayload());
  await settle();

  assert.equal(log.list()[0].status, "failed");
  assert.equal(log.list()[0].deckhand, "202 No matching services found for redeployment");
});

test("the final status comes from DeckHand's build log of the service", async (t) => {
  const fresh = () => new Date().toISOString();
  const { post, remote, log, settle } = await harness(t, {
    deckhandOverrides: { apiToken: API_TOKEN, projectId: "project-1", serviceId: "service-1" },
    responses: [
      ACCEPTED,
      () => Response.json([{ serviceId: "service-1", status: "success", startedAt: "2026-10-01T10:00:00.000Z" }]),
      () => Response.json([{ serviceId: "other", status: "failed", startedAt: fresh() }, { serviceId: "service-1", status: "building", startedAt: fresh() }]),
      () => Response.json([{ serviceId: "service-1", status: "failed", startedAt: fresh() }]),
    ],
  });

  await post(pushPayload());
  await settle();

  assert.equal(remote.calls.length, 4);
  assert.equal(remote.calls[1].url, "https://deckhand.test/api/project/project-1/build-logs");
  assert.equal(remote.calls[1].init.headers.Authorization, `Bearer ${API_TOKEN}`);
  assert.equal(log.list()[0].status, "failed");
});

test("pipeline events are recorded when finished and ignored while running", async (t) => {
  const { post, log, scheduler } = await harness(t);

  const running = await post(pipelinePayload("running"), { event: "Pipeline Hook" });
  const finished = await post(pipelinePayload("success"), { event: "Pipeline Hook" });

  assert.deepEqual(await running.json(), { result: "ignored", reason: "pipeline-running" });
  assert.equal(finished.status, 202);
  assert.deepEqual(await finished.json(), { result: "recorded" });
  assert.equal(scheduler.pending.size, 0);
  assert.deepEqual(
    log.list().map((entry) => [entry.kind, entry.status, entry.pipelineStatus, entry.author]),
    [["pipeline", "recorded", "success", "Festival Editor"]],
  );
});

test("with DEPLOY_ON=pipeline a successful pipeline deploys and a push only records", async (t) => {
  const { post, log, scheduler } = await harness(t, { gitlabOverrides: { deployOn: "pipeline" } });

  await post(pushPayload());
  assert.equal(scheduler.pending.size, 0);
  await post(pipelinePayload("success"), { event: "Pipeline Hook" });

  assert.equal(scheduler.pending.size, 1);
  assert.deepEqual(
    log.list().map((entry) => [entry.kind, entry.status]),
    [
      ["pipeline", "queued"],
      ["push", "recorded"],
    ],
  );
});

test("the status JSON is not cached and carries no secret", async (t) => {
  const { base, post } = await harness(t, { responses: [ACCEPTED] });
  await post(pushPayload());

  const response = await fetch(`${base}/_status/status.json`);
  const text = await response.text();
  const status = JSON.parse(text);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(status.checks[0].status, 200);
  assert.deepEqual(
    [status.deploys[0].sha, status.deploys[0].status, status.deploys[0].branch],
    ["24dd291f", "queued", "deckhand"],
  );
  for (const secret of [HOOK_TOKEN, DECKHAND_SECRET, API_TOKEN]) assert.ok(!text.includes(secret));
});

test("a failed build-log poll during a running build does not end it as no-build", async (t) => {
  const fresh = () => new Date().toISOString();
  const { post, log, settle } = await harness(t, {
    deckhandOverrides: { apiToken: API_TOKEN, projectId: "project-1", serviceId: "service-1" },
    timingOverrides: { buildStartTimeoutMs: -1 },
    responses: [
      ACCEPTED,
      () => Response.json([{ serviceId: "service-1", status: "building", startedAt: fresh() }]),
      { status: 502, body: { message: "Bad Gateway" } },
      new TypeError("fetch failed"),
      () => Response.json([{ serviceId: "service-1", status: "success", startedAt: fresh() }]),
    ],
  });

  await post(pushPayload());
  await settle();

  assert.equal(log.list()[0].status, "success");
});

test("an unexpected error inside a deploy marks it failed and frees the queue", async (t) => {
  const { post, log, deployer, settle, scheduler } = await harness(t, { responses: [ACCEPTED] });
  deployer.track = async () => {
    throw new Error("boom");
  };

  await post(pushPayload());
  await settle();
  await post(pushPayload({ sha: SHA_B }));

  assert.equal(log.list()[1].status, "failed");
  assert.equal(log.list()[1].deckhand, "probe error: boom");
  assert.equal(deployer.running, null);
  assert.equal(scheduler.pending.size, 1);
});

test("a body over the limit answers 413", async (t) => {
  const { post, log } = await harness(t, { appOptions: { maxBodyBytes: 1024 } });

  const response = await post({ ...pushPayload(), padding: "x".repeat(2048) });

  assert.equal(response.status, 413);
  assert.equal(log.list().length, 0);
});

test("the status JSON names the checks without their URLs", async (t) => {
  const { base } = await harness(t);

  const text = await (await fetch(`${base}/_status/status.json`)).text();

  assert.deepEqual(JSON.parse(text).checks, [{ key: "site", ok: true, status: 200, ms: 40, error: null }]);
  assert.ok(!text.includes("lemmaweb.com"));
});

test("a failed poll after the start window, before any build is seen, keeps polling", async (t) => {
  const fresh = () => new Date().toISOString();
  const { post, log, settle } = await harness(t, {
    deckhandOverrides: { apiToken: API_TOKEN, projectId: "project-1", serviceId: "service-1" },
    timingOverrides: { buildStartTimeoutMs: -1 },
    responses: [
      ACCEPTED,
      { status: 502, body: { message: "Bad Gateway" } },
      () => Response.json([{ serviceId: "service-1", status: "success", startedAt: fresh() }]),
    ],
  });

  await post(pushPayload());
  await settle();

  assert.equal(log.list()[0].status, "success");
});

test("a seen build that drops out of the list does not become no-build", async (t) => {
  const fresh = () => new Date().toISOString();
  const { post, log, settle } = await harness(t, {
    deckhandOverrides: { apiToken: API_TOKEN, projectId: "project-1", serviceId: "service-1" },
    timingOverrides: { buildStartTimeoutMs: -1 },
    responses: [
      ACCEPTED,
      () => Response.json([{ serviceId: "service-1", status: "building", startedAt: fresh() }]),
      () => Response.json([]),
      () => Response.json([{ serviceId: "service-1", status: "failed", startedAt: fresh() }]),
    ],
  });

  await post(pushPayload());
  await settle();

  assert.equal(log.list()[0].status, "failed");
});

test("a body far over the limit still gets its 413", async (t) => {
  const { post, log } = await harness(t, { appOptions: { maxBodyBytes: 1024 } });

  const response = await post({ ...pushPayload(), padding: "x".repeat(3 * 1024 * 1024) });

  assert.equal(response.status, 413);
  assert.equal(log.list().length, 0);
});
