# festival-maintenance

A one-page "the website is moving" notice for the Film Festival of the Faculty of Informatics, Masaryk University, served while the site moves to its new host.

- `index.html`: the page, Czech first, then English. It answers every path, with `Cache-Control: no-store` and `noindex`.
- `/archiv` and `/archiv/*` are proxied to the festival archive.
- `Caddyfile`: Caddy serves `festival.fi.muni.cz` and `www.festival.fi.muni.cz` over HTTPS. The certificate is issued on demand, on the first request after DNS points at the host, and only for those two names. Plain HTTP on those names redirects to HTTPS. Any other host is served the page over plain HTTP, for a proxy in front that terminates TLS.
- `docker-compose.yml`: the Traefik labels that route both names to this container. TLS is passed through, so Caddy completes the HTTP-01 challenge itself. `festival.deckhand.lemmaweb.com` is terminated by Traefik.

Run it locally:

```
docker build -t festival-maintenance . && docker run --rm -p 8080:80 festival-maintenance
```
