# syntax=docker/dockerfile:1.7

ARG DEBIAN_TAG=trixie-slim
ARG NGINX_VERSION=1.30.2
ARG NGINX_RTMP_COMMIT=6c7719d0ba32e00b563ec70bd43dad11960fa9c4
ARG HLS_JS_VERSION=1.5.17

FROM debian:${DEBIAN_TAG} AS builder
ARG NGINX_VERSION
ARG NGINX_RTMP_COMMIT
ARG HLS_JS_VERSION

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        libpcre2-dev \
        libssl-dev \
        zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/build

RUN curl -fsSL "https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz" -o nginx.tar.gz && \
    tar -xzf nginx.tar.gz && \
    rm nginx.tar.gz

RUN curl -fsSL "https://github.com/arut/nginx-rtmp-module/archive/${NGINX_RTMP_COMMIT}.tar.gz" -o rtmp.tar.gz && \
    tar -xzf rtmp.tar.gz && \
    mv "nginx-rtmp-module-${NGINX_RTMP_COMMIT}" nginx-rtmp-module && \
    rm rtmp.tar.gz

# Vendored hls.js for the dashboard's preview player on non-Safari browsers.
RUN curl -fsSL \
        "https://cdn.jsdelivr.net/npm/hls.js@${HLS_JS_VERSION}/dist/hls.min.js" \
        -o /hls.min.js

RUN cd "nginx-${NGINX_VERSION}" && \
    ./configure \
        --sbin-path=/usr/local/sbin/nginx \
        --conf-path=/etc/nginx/nginx.conf \
        --error-log-path=/var/log/nginx/error.log \
        --pid-path=/var/run/nginx/nginx.pid \
        --lock-path=/var/lock/nginx/nginx.lock \
        --http-log-path=/var/log/nginx/access.log \
        --http-client-body-temp-path=/var/cache/nginx/client_body \
        --http-proxy-temp-path=/var/cache/nginx/proxy \
        --http-fastcgi-temp-path=/var/cache/nginx/fastcgi \
        --http-uwsgi-temp-path=/var/cache/nginx/uwsgi \
        --http-scgi-temp-path=/var/cache/nginx/scgi \
        --with-http_ssl_module \
        --with-http_v2_module \
        --with-http_stub_status_module \
        --with-threads \
        --with-file-aio \
        --with-pcre-jit \
        --add-module=/tmp/build/nginx-rtmp-module && \
    make -j"$(nproc)" && \
    make install

# Stash the stat.xsl that ships with nginx-rtmp-module for the runtime stage.
RUN cp /tmp/build/nginx-rtmp-module/stat.xsl /stat.xsl


FROM debian:${DEBIAN_TAG} AS runtime
ARG NGINX_VERSION
ARG NGINX_RTMP_COMMIT
ARG VERSION=dev
ARG REVISION=unknown

LABEL org.opencontainers.image.title="nginx-rtmp-docker" \
      org.opencontainers.image.description="nginx ${NGINX_VERSION} with arut/nginx-rtmp-module compiled in, serving RTMP ingest on 1935 and HLS playback + stats on 8080." \
      org.opencontainers.image.source="https://github.com/KingPin/nginx-rtmp-docker" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libpcre2-8-0 \
        libssl3 \
        zlib1g && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 101 nginx && \
    useradd --system --uid 101 --gid nginx --home-dir /var/cache/nginx --shell /usr/sbin/nologin nginx

COPY --from=builder /usr/local/sbin/nginx /usr/local/sbin/nginx
COPY --from=builder /etc/nginx/ /etc/nginx/
COPY --from=builder /stat.xsl /etc/nginx/stat.xsl
COPY nginx.conf /etc/nginx/nginx.conf
COPY dashboard/ /etc/nginx/dashboard/
COPY --from=builder /hls.min.js /etc/nginx/dashboard/vendor/hls.min.js

RUN mkdir -p /var/log/nginx /var/run/nginx /var/lock/nginx \
             /var/cache/nginx/hls /var/cache/nginx/client_body \
             /var/cache/nginx/proxy /var/cache/nginx/fastcgi \
             /var/cache/nginx/uwsgi /var/cache/nginx/scgi && \
    ln -sf /dev/stdout /var/log/nginx/access.log && \
    ln -sf /dev/stderr /var/log/nginx/error.log && \
    chown -R nginx:nginx /var/log/nginx /var/run/nginx /var/lock/nginx /var/cache/nginx /etc/nginx

USER nginx

EXPOSE 1935/tcp 8080/tcp

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
