FROM postgres:17
# Test infrastructure only: freeze the isolated server clock, never the host or
# Production clock. The actual migration/function body and Recorder dates stay
# byte-identical. No network is enabled when the test container runs.
RUN apt-get update && apt-get install -y --no-install-recommends libfaketime \
    && find /usr/lib -name libfaketime.so.1 -exec ln -s '{}' /usr/local/lib/libfaketime.so.1 ';' \
    && rm -rf /var/lib/apt/lists/*
ENV FAKETIME="@2026-09-29 08:00:00" \
    FAKETIME_DONT_FAKE_MONOTONIC=1 \
    FAKETIME_FORCE_MONOTONIC_FIX=1 \
    FAKETIME_NO_CACHE=1 \
    FAKETIME_ONLY_CMDS=postgres
USER postgres
ENTRYPOINT ["bash", "-c", "initdb -D \"$PGDATA\" --auth=trust >/dev/null && exec env LD_PRELOAD=/usr/local/lib/libfaketime.so.1 postgres -D \"$PGDATA\" -c listen_addresses=127.0.0.1"]
