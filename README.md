# nginx-rtmp-docker

A small Debian-based Docker image that compiles [nginx](https://nginx.org/) with
[arut/nginx-rtmp-module](https://github.com/arut/nginx-rtmp-module) statically
linked in. It accepts RTMP ingest, re-publishes the stream as HLS for browser
playback, and exposes a stat page and a health endpoint over HTTP.

Published images are built for `linux/amd64` and `linux/arm64` and pushed to:

```
ghcr.io/kingpin/nginx-rtmp-docker:latest
```

## Quick start

```sh
docker run --rm -d \
  --name nginx-rtmp \
  -p 1935:1935 \
  -p 8080:8080 \
  ghcr.io/kingpin/nginx-rtmp-docker:latest
```

## Endpoints

| Purpose       | URL                                            |
| ------------- | ---------------------------------------------- |
| RTMP ingest   | `rtmp://<host>:1935/live/<stream-key>`         |
| HLS playback  | `http://<host>:8080/hls/<stream-key>.m3u8`     |
| Stats (XML)   | `http://<host>:8080/stat`                      |
| Health probe  | `http://<host>:8080/healthz`                   |

Pick any string for `<stream-key>`; the `live` application has no
authentication. Don't expose 1935 directly to the public internet without a
firewall, proxy, or `on_publish` callback in front of it.

## Publish a test stream

With ffmpeg:

```sh
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 \
       -f lavfi -i sine=frequency=1000 \
       -c:v libx264 -preset veryfast -tune zerolatency -g 60 \
       -c:a aac -ar 44100 -b:a 128k \
       -f flv rtmp://localhost:1935/live/test
```

With OBS Studio:

- **Server**: `rtmp://localhost:1935/live`
- **Stream Key**: anything, e.g. `test`

Then open `http://localhost:8080/hls/test.m3u8` in any HLS-capable player
(VLC, hls.js, Safari).

## Build from source

```sh
git clone https://github.com/KingPin/nginx-rtmp-docker.git
cd nginx-rtmp-docker
docker build -t nginx-rtmp:dev .
```

The Dockerfile is a two-stage build (`builder` + `runtime`). The runtime image
runs as a non-root `nginx` user (uid 101) and ships only the libraries nginx
actually links against — no toolchain.

## What's inside

| Component                   | Pin                                          |
| --------------------------- | -------------------------------------------- |
| Base image                  | `debian:trixie-slim` (Debian 13)             |
| nginx                       | `1.30.2` (stable)                            |
| arut/nginx-rtmp-module      | commit `6c7719d` (post-1.2.2 master)         |
| Architectures published     | `linux/amd64`, `linux/arm64`                 |

To bump nginx or the RTMP module, edit the `ARG` lines at the top of the
`Dockerfile`. That's the single source of truth.

## Configuration

`nginx.conf` lives in the image at `/etc/nginx/nginx.conf`. To override it,
mount your own config:

```sh
docker run --rm -d \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -p 1935:1935 -p 8080:8080 \
  ghcr.io/kingpin/nginx-rtmp-docker:latest
```

If you need to record streams, mount a writable volume at
`/var/cache/nginx/hls` (or wherever you point `hls_path`), and ensure it's
writable by uid 101.

## License

MIT. See `LICENSE`.
