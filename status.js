(() => {
  const REFRESH_MS = 30_000;
  const time = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const DEPLOY_STATUS = {
    queued: "Čeká na nasazení · Queued",
    deploying: "Volám DeckHand · Calling DeckHand",
    accepted: "Nasazuje se · Deploying",
    success: "Nasazeno · Deployed",
    failed: "Selhalo · Failed",
    "no-build": "Sestavení nezačalo · Build did not start",
    timeout: "Bez výsledku · No result",
    untracked: "Přijato DeckHandem · Accepted by DeckHand",
    recorded: "Zaznamenáno · Recorded",
  };

  function formatTime(iso) {
    return iso ? time.format(new Date(iso)) : "–";
  }

  function checkState(check) {
    if (check.ok === null) return "…";
    const detail = check.status ?? (check.error === "timeout" ? "timeout" : "nedostupné · unreachable");
    return check.ok ? `V provozu · Up (${detail})` : `Nedostupné · Down (${detail})`;
  }

  function deployStatus(deploy) {
    if (deploy.status === "coalesced") return `Sloučeno do ${deploy.deployedWith} · Merged into ${deploy.deployedWith}`;
    if (deploy.kind === "pipeline" && deploy.status === "recorded") return `CI pipeline: ${deploy.pipelineStatus}`;
    return DEPLOY_STATUS[deploy.status] ?? deploy.status;
  }

  function renderChecks(status) {
    for (const check of status.checks) {
      const row = document.querySelector(`[data-check="${check.key}"]`);
      if (!row) continue;
      row.dataset.state = check.ok === null ? "" : check.ok ? "up" : "down";
      row.querySelector(".state").textContent = checkState(check);
    }
    document.getElementById("checked-at").textContent = status.checkedAt
      ? `Naposledy ověřeno ${formatTime(status.checkedAt)} · Last checked ${formatTime(status.checkedAt)}`
      : "Ověřuji… · Checking…";
  }

  function renderDeploys(deploys) {
    const list = document.getElementById("deploys");
    document.getElementById("deploys-empty").hidden = deploys.length > 0;
    list.replaceChildren(
      ...deploys.map((deploy) => {
        const item = document.createElement("li");
        const head = document.createElement("div");
        const sha = document.createElement("code");
        sha.textContent = deploy.sha ?? "–";
        head.append(sha, ` ${deployStatus(deploy)}`);
        const meta = document.createElement("div");
        meta.className = "meta";
        const parts = [formatTime(deploy.receivedAt), deploy.kind, deploy.branch, deploy.author].filter(Boolean);
        if (deploy.finishedAt) parts.push(`hotovo · done ${formatTime(deploy.finishedAt)}`);
        meta.textContent = parts.join(" · ");
        if (deploy.deckhand) meta.title = `DeckHand: ${deploy.deckhand}`;
        item.append(head, meta);
        return item;
      }),
    );
  }

  async function refresh() {
    try {
      const response = await fetch("/_status/status.json", { cache: "no-store" });
      if (!response.ok) throw new Error(String(response.status));
      const status = await response.json();
      renderChecks(status);
      renderDeploys(status.deploys);
    } catch {
      document.getElementById("checked-at").textContent = "Stav teď není k dispozici. · The status is unavailable right now.";
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
