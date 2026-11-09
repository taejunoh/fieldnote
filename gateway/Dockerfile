# syntax=docker/dockerfile:1
FROM golang:1.27.3-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY vendor/openllms-76945701e6822512ca7370d5583db6822e16eb83.tar vendor/SHA256SUMS vendor/PROVENANCE.txt /tmp/openllms-source/
RUN cd /tmp/openllms-source \
    && sha256sum --check SHA256SUMS \
    && tar -xf openllms-76945701e6822512ca7370d5583db6822e16eb83.tar -C /src --no-same-owner
COPY patches/0001-sports-desk-compat.patch /tmp/compat.patch
RUN git apply --check /tmp/compat.patch && git apply /tmp/compat.patch
RUN go test ./internal/httpserver/... ./internal/proxy/... ./internal/store/... ./cmd/llms-gateway
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/llms-gateway ./cmd/llms-gateway

FROM alpine:3.21
RUN apk add --no-cache su-exec ca-certificates \
    && adduser -D -u 65532 nonroot \
    && mkdir -p /data/secrets \
    && chown -R nonroot:nonroot /data
COPY --from=build /out/llms-gateway /llms-gateway
COPY --from=build /src/deploy/oss/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod 0755 /docker-entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint.sh"]
