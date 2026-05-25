# Configuration examples

Each `*.conf` here is a complete drop-in replacement for the in-image
`/etc/nginx/nginx.conf`. Mount one over the default to try it:

```sh
docker run --rm -d \
  -p 1935:1935 -p 8080:8080 \
  -v "$PWD/examples/nginx-record-to-disk.conf:/etc/nginx/nginx.conf:ro" \
  ghcr.io/kingpin/nginx-rtmp-docker:latest
```

Or, with the root `compose.yaml`, uncomment the matching `volumes:` line.

| File                                | What it shows                                                  |
| ----------------------------------- | -------------------------------------------------------------- |
| `nginx-record-to-disk.conf`         | Record every publish to a flv on a host volume                 |
| `nginx-relay-restream.conf`         | Mirror one ingest to multiple downstream RTMP services         |
| `nginx-auth-on-publish.conf`        | Validate stream keys via an HTTP callback before publish       |
| `nginx-stat-allowlist.conf`         | Restrict `/stat` and the dashboard to specific source IPs      |
| `compose-with-caddy/`               | Reverse proxy 8080 with automatic Let's Encrypt TLS via Caddy  |

All `.conf` examples keep the dashboard, HLS playback, `/stat`, and
`/healthz` endpoints working — they only add or tighten the feature each
example demonstrates. Diff any example against the base `nginx.conf` to
see exactly what changed.
