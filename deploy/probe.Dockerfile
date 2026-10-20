FROM alpine:3
RUN apk add --no-cache nodejs
WORKDIR /app
COPY probe/package.json probe/main.js ./
COPY probe/src ./src
RUN mkdir -p /data && chown nobody:nobody /data
USER nobody
EXPOSE 8080
CMD ["node", "main.js"]
