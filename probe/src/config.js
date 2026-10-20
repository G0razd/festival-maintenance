const SECOND = 1000;
const MINUTE = 60 * SECOND;

export function readConfig(env = process.env) {
  return {
    port: Number(env.PORT || 8080),
    dataFile: env.DATA_FILE || "/data/deploys.json",
    checkIntervalMs: 30 * SECOND,
    checkTimeoutMs: 8 * SECOND,
    checks: [
      { key: "site", url: env.SITE_CHECK_URL || "https://festival-26.deckhand.lemmaweb.com/" },
      { key: "cms", url: env.CMS_CHECK_URL || "https://cms.deckhand.lemmaweb.com/server/ping" },
      { key: "archive", url: env.ARCHIVE_CHECK_URL || "https://archiv.deckhand.lemmaweb.com/" },
    ],
    gitlab: {
      token: env.GITLAB_HOOK_TOKEN || "",
      project: env.GITLAB_PROJECT || "lemma/web/festival-26",
      branch: env.GITLAB_BRANCH || "deckhand",
      deployOn: env.DEPLOY_ON === "pipeline" ? "pipeline" : "push",
    },
    deckhand: {
      hookUrl: env.DECKHAND_HOOK_URL || "https://deckhand.lemma.fi.muni.cz/api/webhooks/gitlab",
      hookSecret: env.DECKHAND_HOOK_SECRET || "",
      repoUrl: env.DECKHAND_REPO_URL || "https://gitlab.fi.muni.cz/lemma/web/festival-26.git",
      apiUrl: env.DECKHAND_API_URL || "https://deckhand.lemma.fi.muni.cz",
      apiToken: env.DECKHAND_API_TOKEN || "",
      projectId: env.DECKHAND_PROJECT_ID || "",
      serviceId: env.DECKHAND_SERVICE_ID || "",
    },
    deploy: {
      debounceMs: Number(env.DEBOUNCE_MS || MINUTE),
      retryDelayMs: 5 * SECOND,
      requestTimeoutMs: 20 * SECOND,
      pollMs: 30 * SECOND,
      buildStartTimeoutMs: 5 * MINUTE,
      trackTimeoutMs: 120 * MINUTE,
    },
  };
}
