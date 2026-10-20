const FINAL_BUILD_STATUS = new Set(["success", "failed"]);
const BUILD_START_SLACK_MS = 10_000;

function shortDetail(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

export class Deployer {
  constructor({
    log,
    deckhand,
    gitlab,
    timing,
    fetch = globalThis.fetch,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    this.log = log;
    this.deckhand = deckhand;
    this.gitlab = gitlab;
    this.timing = timing;
    this.fetch = fetch;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.sleep = sleep;
    this.pending = [];
    this.timer = null;
    this.running = null;
  }

  enqueue(entryId) {
    this.pending.push(entryId);
    if (this.running) return;
    this.schedule();
  }

  schedule() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, this.timing.debounceMs);
  }

  async flush() {
    if (this.running || this.pending.length === 0) return this.running;
    const ids = this.pending.splice(0);
    const leadId = ids[ids.length - 1];
    const lead = this.log.find(leadId);
    for (const id of ids.slice(0, -1)) {
      this.log.update(id, { status: "coalesced", deployedWith: lead?.sha?.slice(0, 8) ?? null });
    }
    this.running = this.deploy(leadId)
      .catch((error) => {
        this.log.update(leadId, {
          status: "failed",
          deckhand: shortDetail(`probe error: ${error.message}`),
          finishedAt: new Date(this.now()).toISOString(),
        });
      })
      .finally(() => {
        this.running = null;
        if (this.pending.length > 0) this.schedule();
      });
    return this.running;
  }

  async deploy(entryId) {
    const entry = this.log.find(entryId);
    this.log.update(entryId, { status: "deploying" });
    const startedAt = this.now();
    const call = await this.callDeckhand(entry?.sha);
    if (!call.ok) {
      this.log.update(entryId, { status: "failed", deckhand: call.detail, finishedAt: new Date(this.now()).toISOString() });
      return;
    }
    this.log.update(entryId, { status: "accepted", deckhand: call.detail });
    const outcome = await this.track(startedAt);
    this.log.update(entryId, { status: outcome, finishedAt: new Date(this.now()).toISOString() });
  }

  async callDeckhand(sha) {
    if (!this.deckhand.hookSecret) return { ok: false, detail: "DeckHand hook secret not configured" };
    let last = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      last = await this.postHook(sha);
      if (last.ok || !last.retry) return last;
      if (attempt === 1) await this.sleep(this.timing.retryDelayMs);
    }
    return last;
  }

  async postHook(sha) {
    const payload = {
      object_kind: "push",
      ref: `refs/heads/${this.gitlab.branch}`,
      checkout_sha: sha,
      project: { git_http_url: this.deckhand.repoUrl, path_with_namespace: this.gitlab.project },
    };
    try {
      const response = await this.fetch(this.deckhand.hookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Gitlab-Event": "Push Hook",
          "X-Gitlab-Token": this.deckhand.hookSecret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timing.requestTimeoutMs),
      });
      const text = await response.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      const matched = Array.isArray(body?.services) && body.services.length > 0;
      const detail = shortDetail(`${response.status} ${body?.message ?? text}`);
      if (response.status === 202 && matched) return { ok: true, detail };
      return { ok: false, retry: response.status >= 500, detail };
    } catch (error) {
      return { ok: false, retry: true, detail: shortDetail(error.name === "TimeoutError" ? "DeckHand timed out" : `DeckHand unreachable: ${error.message}`) };
    }
  }

  async track(startedAt) {
    const { apiUrl, apiToken, projectId, serviceId } = this.deckhand;
    if (!apiToken || !projectId || !serviceId) return "untracked";
    const deadline = startedAt + this.timing.trackTimeoutMs;
    let seen = false;
    while (this.now() < deadline) {
      const { answered, build } = await this.latestBuild(apiUrl, apiToken, projectId, serviceId, startedAt);
      if (build) {
        seen = true;
        if (FINAL_BUILD_STATUS.has(build.status)) return build.status;
      } else if (answered && !seen && this.now() - startedAt > this.timing.buildStartTimeoutMs) {
        return "no-build";
      }
      await this.sleep(this.timing.pollMs);
    }
    return "timeout";
  }

  async latestBuild(apiUrl, apiToken, projectId, serviceId, startedAt) {
    try {
      const response = await this.fetch(`${apiUrl}/api/project/${projectId}/build-logs`, {
        headers: { Authorization: `Bearer ${apiToken}` },
        signal: AbortSignal.timeout(this.timing.requestTimeoutMs),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { answered: false, build: null };
      }
      const builds = await response.json();
      if (!Array.isArray(builds)) return { answered: false, build: null };
      const build = builds.find(
        (candidate) =>
          candidate.serviceId === serviceId && Date.parse(candidate.startedAt) >= startedAt - BUILD_START_SLACK_MS,
      );
      return { answered: true, build: build ?? null };
    } catch {
      return { answered: false, build: null };
    }
  }
}
