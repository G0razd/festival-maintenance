# festival-maintenance

The status page and front door of the Film Festival of the Faculty of Informatics, Masaryk University, while the site moves to its new host. It runs on DeckHand as project `festival-status`, service `status`, at `https://status.deckhand.lemmaweb.com`.

- `index.html` + `status.js`: one page, Czech first, then English. It says the website is moving and shows live whether the festival website, the CMS and the archive answer, and the last deploys. It answers every path, with `Cache-Control: no-store` and `noindex`.
- `Caddyfile`: Caddy serves `festival.fi.muni.cz` and `www.festival.fi.muni.cz` over HTTPS with an on-demand certificate, issued only for those two names. Plain HTTP on those names redirects to HTTPS. Every other host gets the page over plain HTTP, behind a proxy that terminates TLS. `/archiv` and `/archiv/*` are proxied to the festival archive.
- `FRONT_MODE=site` makes Caddy proxy both MUNI names to `SITE_UPSTREAM` (default `https://festival-26.deckhand.lemmaweb.com`) and serve the page only when the site answers 502, 503 or 504. `PREVIEW_HOST` moves the label route off `festival.deckhand.lemmaweb.com`.
- `probe/`: a small Node server with no dependencies. It runs the health checks (cached 30 s) and serves `/_status/status.json`. It also takes the GitLab webhook at `POST /hooks/gitlab` on the status host and redeploys festival-26 through DeckHand. See [docs/status.md](docs/status.md).
- `docker-compose.yml`: the two containers (`web` = Caddy, `status-probe`) and the Traefik labels that route the MUNI names and the preview host to `web`. TLS for the MUNI names is passed through, so Caddy completes the HTTP-01 challenge itself.

Run the probe's tests:

```
cd probe; npm test
```

Run it locally:

```
docker compose up --build
```

The Dockerfiles live in `deploy/`, because DeckHand builds a root `Dockerfile` with Railpack instead of reading the compose file.
