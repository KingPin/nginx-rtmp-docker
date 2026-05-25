# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Docker image that compiles nginx from source on `debian:trixie-slim` as a
two-stage build, statically linking in
[arut/nginx-rtmp-module](https://github.com/arut/nginx-rtmp-module). The
runtime stage drops the toolchain and runs as a non-root `nginx` user
(uid 101). The image accepts RTMP ingest on 1935 and serves HLS playback,
a `/stat` XML page, a `/healthz` probe, and a small read-only dashboard at
`/` on port 8080.

Tracked code:

- `Dockerfile` — multi-stage build (`builder` + `runtime`)
- `nginx.conf` — RTMP `live` application + the HTTP server
- `dashboard/` — vanilla-JS single-page dashboard served from `/`
- `examples/` — drop-in `nginx.conf` variants for common setups
  (recording, multi-target restream, on_publish auth, /stat allow-list)
  plus a Caddy TLS sidecar compose
- `compose.yaml` — root Compose definition for the published image
- `.github/workflows/docker-publish.yml` — CI build + scan + publish

There is no application server beyond nginx itself; the dashboard is
static HTML/CSS/JS that polls `/stat` in the browser.

## Build & run

```bash
# Build locally
docker build -t nginx-rtmp .

# Run (RTMP on 1935, HLS + /stat + dashboard + /healthz on 8080)
docker run --rm -d -p 1935:1935 -p 8080:8080 nginx-rtmp

# Or via Compose
docker compose up -d

# Smoke test (matches the CI step)
docker run --rm nginx-rtmp nginx -V
```

Publish to `rtmp://<host>:1935/live/<stream-key>` and play back from
`http://<host>:8080/hls/<stream-key>.m3u8`.

## Versions are pinned in the Dockerfile

Upstream versions and their SHA256s are pinned via `ARG` at the top of
`Dockerfile`:

- `NGINX_VERSION` / `NGINX_SHA256` — nginx source tarball
- `NGINX_RTMP_COMMIT` / `NGINX_RTMP_SHA256` — arut/nginx-rtmp-module
  archive at a specific commit
- `HLS_JS_VERSION` / `HLS_JS_SHA256` — vendored hls.js for the dashboard
- `DEBIAN_TAG` — base image tag

Each downloaded tarball is verified with `sha256sum -c -` before
extraction; mismatches fail the build. Bumping a version means updating
both the `*_VERSION` (or `*_COMMIT`) and the matching `*_SHA256`. Don't
introduce a separate versions file — the Dockerfile is the single source
of truth.

## nginx is compiled, not apt-installed

`./configure` flags in the builder stage (paths, `--with-http_ssl_module`,
`--with-http_v2_module`, `--with-http_stub_status_module`, `--with-threads`,
`--with-file-aio`, `--with-pcre-jit`, the `--add-module=...` for
nginx-rtmp-module) define the final binary's capabilities. Adding a feature
(another nginx module, a different SSL option) means adding a `--with-*`
/ `--add-module=*` flag here and rebuilding — `apt-get install nginx-*`
will not work and isn't installed.

The runtime stage `ln -sf`s `access.log` → `/dev/stdout` and `error.log`
→ `/dev/stderr`, so nginx logs land on the container's stdout/stderr.
Don't reintroduce file-based logging without a deliberate reason.

`/etc/nginx` stays root-owned in the runtime stage — `nginx` (uid 101)
only needs read access to its config, and root ownership shrinks the
blast radius of an in-container compromise. The recursive chown is
scoped to `/var/log/nginx`, `/var/run/nginx`, `/var/lock/nginx`, and
`/var/cache/nginx`.

## CI publishes multi-arch to GHCR

`.github/workflows/docker-publish.yml` builds for
`linux/amd64,linux/arm64` via QEMU + Buildx and pushes to
`ghcr.io/kingpin/<repo>:latest` on pushes to `main`, PRs targeting
`main`, the weekly cron (Mondays 17:31 UTC), and `workflow_dispatch`.
The job runs Trivy (MEDIUM/HIGH/CRITICAL, `ignore-unfixed: true`) and
uploads SARIF to the Security tab — the SARIF upload is gated on
`github.event.pull_request.head.repo.full_name == github.repository` so
forked-PR runs (which have a read-only `GITHUB_TOKEN`) don't fail on the
upload step.

The Trivy step scans a locally-loaded test image tagged
`nginx-rtmp:ci-${{ github.sha }}` — no external registry credentials are
needed for scanning. Docker Hub and Quay.io login/publish steps exist
as commented-out templates; leave them commented unless the user asks to
re-enable them.

## Identity for commits / PRs

Use `KingPin <28669+KingPin@users.noreply.github.com>` (matches existing
git history and the user's global instruction). Ignore the `userEmail`
injected by the Claude Code harness.
