FROM clickhouse/clickhouse-server:24.8.14.39-alpine@sha256:b002e56ed5c16e224c312527f6fcba7e77216fec5d7a88a7828f59efc614feb5

USER root

RUN apk add --no-cache \
      ca-certificates=20260413-r0 \
      curl=8.14.1-r2 \
      jq=1.7.1-r0 \
      postgresql16-client=16.15-r0 \
      rclone=1.68.2-r5

COPY entrypoint.sh /usr/local/bin/twenty-backup

RUN chmod 0555 /usr/local/bin/twenty-backup

ENTRYPOINT ["/usr/local/bin/twenty-backup"]
