export class Checker {
  constructor({ checks, timeoutMs, fetch = globalThis.fetch, now = () => Date.now() }) {
    this.checks = checks;
    this.timeoutMs = timeoutMs;
    this.fetch = fetch;
    this.now = now;
    this.snapshot = { checkedAt: null, results: checks.map(({ key, url }) => ({ key, url, ok: null, status: null })) };
    this.inFlight = null;
  }

  current() {
    return this.snapshot;
  }

  run() {
    if (!this.inFlight) {
      this.inFlight = Promise.all(this.checks.map((check) => this.probe(check)))
        .then((results) => {
          this.snapshot = { checkedAt: new Date(this.now()).toISOString(), results };
        })
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  async probe({ key, url }) {
    const started = this.now();
    try {
      const response = await this.fetch(url, {
        redirect: "follow",
        headers: { "User-Agent": "festival-status" },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      await response.body?.cancel();
      return { key, url, status: response.status, ok: response.status >= 200 && response.status < 400, ms: this.now() - started };
    } catch (error) {
      return { key, url, status: null, ok: false, ms: this.now() - started, error: error.name === "TimeoutError" ? "timeout" : "unreachable" };
    }
  }
}
