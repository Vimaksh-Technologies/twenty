FROM postgres:16.9-alpine@sha256:7c688148e5e156d0e86df7ba8ae5a05a2386aaec1e2ad8e6d11bdf10504b1fb7

RUN apk add --no-cache ca-certificates curl rclone

COPY entrypoint.sh /usr/local/bin/twenty-backup

RUN chmod 0555 /usr/local/bin/twenty-backup

ENTRYPOINT ["/usr/local/bin/twenty-backup"]
