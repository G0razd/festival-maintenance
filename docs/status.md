# Status checks and the GitLab deploy hook

## Purpose
- The page shows whether the festival website, the CMS and the archive answer, and the last 10 deploy events.
- Until DeckHand's own push-to-deploy reaches GitLab, a push to festival-26's `deckhand` branch redeploys the site through this hook.

## Data flow
- **Checks.** `status-probe` runs `GET` on three public URLs every 30 s (`checker.js`). It keeps the HTTP status, a latency and an error kind (`timeout` / `unreachable`). The browser only reads `/_status/status.json`, so it never calls the CMS. The JSON is `Cache-Control: no-store`.
  - `SITE_CHECK_URL`, default `https://festival-26.deckhand.lemmaweb.com/`
  - `CMS_CHECK_URL`, default `https://cms.deckhand.lemmaweb.com/server/ping`
  - `ARCHIVE_CHECK_URL`, default `https://archiv.deckhand.lemmaweb.com/`
- **Hook.** `POST /hooks/gitlab` is routed only on `STATUS_HOST` (`server.js`, `gitlab.js`).
  1. It checks `X-Gitlab-Token` against `GITLAB_HOOK_TOKEN` in constant time (SHA-256 of both, then `timingSafeEqual`). If the token is unset, every call is refused.
  2. It reads the event (`Push Hook` or `Pipeline Hook`) and acts only on `GITLAB_PROJECT` + `GITLAB_BRANCH`.
  3. A deploy event is queued, and the deployer calls DeckHand (`deployer.js`).
- **DeckHand call.** The deployer sends DeckHand's GitLab webhook (`DECKHAND_HOOK_URL`) a minimal push payload, signed with that service's own webhook secret (`DECKHAND_HOOK_SECRET`). DeckHand then redeploys every service whose repository and branch match. Success is `202` with a non-empty `services` list.
- **Final status.** With `DECKHAND_API_TOKEN`, `DECKHAND_PROJECT_ID` and `DECKHAND_SERVICE_ID` set, the deployer polls `GET /api/project/<id>/build-logs` every 30 s. It looks for the service's build that started after the call, and records `success` or `failed`. Without them the entry stays `untracked`.

## Responses
| Case | Status |
| --- | --- |
| Token missing or wrong | `401` |
| Not POST | `405`, `Allow: POST` |
| Body over 5 MB | `413` |
| Body is not JSON | `400` |
| Other project, other branch, deleted branch, pipeline still running, other event | `200 {"result":"ignored","reason":…}` |
| Push (default) | `202 {"result":"queued"}` |
| Finished pipeline (default) | `202 {"result":"recorded"}` |

## Decisions
- **What deploys.** `DEPLOY_ON=push` (default) deploys on a push. `DEPLOY_ON=pipeline` deploys on a successful pipeline instead, and only records pushes. Finished pipelines (`success`, `failed`, `canceled`) are always recorded; running ones are ignored, so they don't flood the 10 entries.
- **Debounce.** The first deploy event starts a 60 s window (`DEBOUNCE_MS`), and each new event restarts it.
  - When the window closes, one DeckHand call deploys the newest commit. The older entries become `coalesced`, with the sha they went out with.
  - A festival-26 deploy takes about 45 minutes. Events that arrive during it wait, and give exactly one more deploy after it.
- **Retry.** A network error, a timeout or a 5xx from DeckHand is retried once, after 5 s. A 4xx is not retried; it means a wrong secret or a wrong repo/branch, and a retry would not help. If DeckHand matches no service, that counts as failed.
- **Tracking limits.** No build within 5 minutes gives `no-build`, for example when DeckHand failed before the build. No final state within 120 minutes gives `timeout`.
- **Store.** The last 10 entries are kept in `/data/deploys.json` on the `status-data` volume, written atomically.
  - On DeckHand `7ff739c` a redeploy starts with empty volumes (deckhand KI 136), so the log is lost on every redeploy of this service.
  - It survives container restarts.
- **No secrets leave the probe.** The JSON carries short shas, author names from GitLab, statuses and DeckHand's reply message, never a token. A test pins this.

## Tests
`probe/test/hook.test.js` covers:
- a wrong or missing token, and an unset token;
- `GET` → 405;
- a wrong branch and a wrong project;
- the debounce, and a push during a running deploy;
- a failed DeckHand call with one retry, recovery on the retry, no retry on 401, and no matched service;
- the final status from build logs;
- pipeline handling and `DEPLOY_ON=pipeline`;
- no secrets in the JSON.

`probe/test/units.test.js` covers the token compare, the checker and the deploy log file.
