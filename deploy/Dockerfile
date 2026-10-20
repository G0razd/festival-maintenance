FROM caddy:2.11-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html /srv/index.html
RUN caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
EXPOSE 80 443
