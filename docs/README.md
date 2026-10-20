# Docs map

| Area | Doc | Entry files | Tests |
| --- | --- | --- | --- |
| Front door (Caddy, MUNI TLS, FRONT_MODE) | [../README.md](../README.md) | `Caddyfile`, `docker-compose.yml`, `deploy/Dockerfile` | none; `caddy validate` runs in the image build |
| Status checks, deploy log, GitLab hook | [status.md](status.md) | `probe/main.js`, `probe/src/*.js`, `status.js` | `probe/test/*.test.js` (`cd probe; npm test`) |
