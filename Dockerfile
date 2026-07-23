# ── Stage 1: install dependencies ─────────────────────────────────────────────
FROM node:26-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# BuildKit cache mount: a lockfile change re-resolves from the local npm cache
# instead of re-downloading the whole registry tree.
RUN --mount=type=cache,target=/root/.npm npm ci

# ── Stage 1b: prisma CLI for the runtime image ────────────────────────────────
# The boot migration (entrypoint.sh) and install.sh update's `npx prisma migrate
# status` need the Prisma CLI, which the standalone trace below does NOT
# include — and the CLI has its own transitive deps (@prisma/config → effect,
# engines…), so cherry-picking folders from the full tree is whack-a-mole.
# Instead: a clean install of just the CLI, pinned to the app's own prisma
# version, gives a complete self-contained closure to copy into the runner.
FROM node:26-alpine AS prisma-cli
WORKDIR /cli
# The app's package.json stays OUT of this directory — `npm install <pkg>`
# next to a package.json would install the whole app tree alongside it,
# defeating the point. It's read from /tmp only to pin the version.
COPY package.json /tmp/app-package.json
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-save --no-audit --no-fund \
      "prisma@$(node -p "require('/tmp/app-package.json').devDependencies.prisma")"

# ── Stage 2: build ─────────────────────────────────────────────────────────────
FROM node:26-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Generate Prisma client before building
RUN npx prisma generate
RUN npm run build

# ── Stage 3: production runtime ────────────────────────────────────────────────
FROM node:26-alpine AS runner
WORKDIR /app

ARG GIT_SHA=unknown
ARG BUILD_TIME=""
# "develop" on integration-branch images — the app shows a yellow banner.
ARG CHANNEL=""
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV APP_GIT_SHA=$GIT_SHA
ENV APP_BUILD_TIME=$BUILD_TIME
ENV APP_CHANNEL=$CHANNEL
# The standalone server.js binds these. Port 3000 (unprivileged): the
# container runs as the non-root `node` user, which cannot bind :80 —
# traefik / the compose ports mapping remap it externally.
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache libc6-compat openssl

# The runtime never runs npm/yarn/corepack (the entrypoint calls
# node_modules/.bin/prisma directly), and npm's bundled deps keep surfacing
# in the weekly image scan (undici CVE-2026-12151). Ship node only.
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn*

# Standalone output: server.js + only the traced node_modules subset the app
# imports — this is what keeps the image small (the full tree is ~970 MB and
# made the old image 1.55 GB).
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/public ./public

# Prisma for boot migrations + install.sh update verification: schema + migrations,
# the self-contained CLI closure (incl. node_modules/.bin/prisma, so
# `npx prisma …` keeps working), and the generated client (the app loads it
# at runtime; belt-and-braces alongside the standalone trace).
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node --from=prisma-cli /cli/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# The what's-new dialog (/api/admin/changelog) reads this at runtime.
COPY --chown=node:node --from=builder /app/CHANGELOG.md ./CHANGELOG.md

# CI bakes the read-only GitHub update-check token in as an AES-256-GCM blob
# (BuildKit secret — never in a layer or the image env). The key is public
# (a byte array so secret scanners don't mistake it for a leak; keep in sync
# with IMAGE_TOKEN_KEY in src/lib/updateCheck.ts): alone it decrypts nothing,
# and the blob only exists in registry-gated images. Local builds without
# the secret simply skip this — the file stays absent.
RUN --mount=type=secret,id=update_check_token,required=false \
    if [ -s /run/secrets/update_check_token ]; then \
      node -e "const c=require('crypto'),fs=require('fs');const key=Buffer.from([164,37,175,137,198,145,115,154,227,48,134,3,41,39,205,38,80,255,128,227,73,195,154,143,124,132,171,43,237,57,10,78]);const t=fs.readFileSync('/run/secrets/update_check_token','utf8').trim();const iv=c.randomBytes(12);const ci=c.createCipheriv('aes-256-gcm',key,iv);const e=Buffer.concat([ci.update(t,'utf8'),ci.final()]);fs.writeFileSync('/app/.update-check-token.enc',Buffer.concat([iv,ci.getAuthTag(),e]));" \
      && chown node:node /app/.update-check-token.enc; \
    fi

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /app/traefik && chown node:node /app /app/traefik

# Non-root (trivy DS-0002): everything the app writes is owned by `node`;
# the ./traefik bind mount must be chowned 1000:1000 on the host (install.sh setup
# does this; existing installs: `chown -R 1000:1000 ./traefik`).
USER node

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
