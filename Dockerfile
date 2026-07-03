# Runs the whole app on one server: the Next.js web app plus the BRouter routing
# engine (Java) with the NL/BE map data. Build once, run anywhere with Docker
# (Railway, Fly.io, a VPS, ...).

########## build the web app ##########
FROM node:22-bookworm AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

########## runtime image ##########
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    BROUTER_JAVA=java \
    DATA_DIR=/data

# Java for BRouter + tools to fetch the map data during the build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      openjdk-17-jre-headless curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# BRouter engine jar + NL/BE map segments (downloaded here so the git repo and
# the build context stay small). This is the slow, rarely-changing layer.
RUN mkdir -p /data brouter/segments4 brouter/customprofiles \
 && curl -fSL "https://github.com/abrensch/brouter/releases/download/v1.7.9/brouter-1.7.9.zip" -o /tmp/b.zip \
 && unzip -oq /tmp/b.zip -d /tmp/b \
 && cp "$(find /tmp/b -name '*-all.jar' | head -1)" brouter/brouter-1.7.9-all.jar \
 && rm -rf /tmp/b /tmp/b.zip \
 && for t in E0_N50 E5_N50 E0_N45 E5_N45; do \
      curl -fSL "https://brouter.de/brouter/segments4/$t.rd5" -o "brouter/segments4/$t.rd5"; \
    done

# The built app + production dependencies (native better-sqlite3 already built
# in the build stage for this same Debian/Node platform).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/scripts/start-brouter.mjs ./scripts/start-brouter.mjs
COPY --from=build /app/brouter/profiles2 ./brouter/profiles2

EXPOSE 3000

# Start BRouter in the background, wait until it accepts connections, then start
# the web app on the port the host provides ($PORT, default 3000).
CMD ["sh", "-c", "node scripts/start-brouter.mjs & for i in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:${BROUTER_PORT:-17777}/ && break; sleep 1; done; exec node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
