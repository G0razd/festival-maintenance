# festival-maintenance

A one-page "the website is moving" notice for the Film Festival of the Faculty of Informatics, Masaryk University, served while the site moves to its new host.

- `index.html`: the page, Czech first, then English. It answers every path, with `Cache-Control: no-store` and `noindex`.
- `/archiv` and `/archiv/*` are proxied to the festival archive.
- `Caddyfile`: Caddy serves `festival.fi.muni.cz` and `www.festival.fi.muni.cz` over HTTPS. The certificate is issued on demand, on the first request after DNS points at the host, and only for those two names. Plain HTTP on those names redirects to HTTPS. Any other host is served the page over plain HTTP, for a proxy in front that terminates TLS.
- `FRONT_MODE=site` makes Caddy proxy both names to `SITE_UPSTREAM` (default `https://festival-26.deckhand.lemmaweb.com`) and serve the page only if the site answers 502, 503 or 504. `PREVIEW_HOST` moves the plain-HTTP host off `festival.deckhand.lemmaweb.com`, so the page stays reachable for checks.
- `docker-compose.yml`: the build and the Traefik labels that route both names to this container. TLS is passed through, so Caddy completes the HTTP-01 challenge itself. `festival.deckhand.lemmaweb.com` is terminated by Traefik.

Run it locally:

```
docker build -f deploy/Dockerfile -t festival-maintenance . && docker run --rm -p 8080:80 festival-maintenance
```

The Dockerfile lives in `deploy/` because DeckHand builds a root `Dockerfile` with Railpack instead of reading the compose file.
