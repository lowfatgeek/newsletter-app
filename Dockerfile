# syntax=docker/dockerfile:1

# KelasWFA Newsletter — image produksi.
# Build:  docker build -t kelaswfa-newsletter .
# Run:    docker run -p 4321:4321 --env-file .env.production kelaswfa-newsletter
# Service ini stateless: semua state ada di Postgres + R2. Jangan simpan
# volume untuk app; cukup environment variable (lihat .env.example).

# ---------- Stage 1: build ----------
FROM node:22-slim AS build
WORKDIR /app

# Install dulu hanya manifest supaya layer dependency ter-cache selama
# package.json / package-lock.json tidak berubah.
COPY package.json package-lock.json ./
RUN npm ci

# Salin sisa source lalu build Astro (adapter node standalone).
COPY . .
# TEST_TIMER_MS default 30000 (30 detik) — JANGAN set nilai kecil di produksi,
# itu hanya untuk e2e.
RUN npm run build

# Pangkas devDependencies supaya image runtime ramping.
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
# Salin source code yang dibutuhkan skrip migrasi/seed (tsx menjalankan
# scripts/*.ts yang mengimpor src/lib/db.ts) di dalam container runtime.
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src

# Astro node-standalone membaca HOST dan PORT dari env.
# 0.0.0.0 wajib agar bisa dijangkau dari luar container (reverse proxy Easypanel).
# CATATAN PORT: nilai PORT di bawah hanya DEFAULT image. Easypanel menyuntikkan
# PORT miliknya saat runtime dan env runtime selalu menang atas ENV image — jadi
# jangan pernah menganggap port-nya 4321 sebelum melihat baris log
# "[@astrojs/node] Server listening on ... :<port>".
ENV HOST=0.0.0.0
ENV PORT=4321
EXPOSE 4321

# Health check bawaan Docker: GET /api/health harus 200.
# Port diambil dari PORT runtime (fallback 4321) — angka tetap di sini pernah
# membuat container selalu "unhealthy" begitu Easypanel menyuntik PORT lain,
# karena check-nya menembak port yang tidak ada yang mendengarkan.
# (Easypanel memakai health check-nya sendiri; ini untuk `docker run` manual.)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const p=process.env.PORT||4321;fetch('http://127.0.0.1:'+p+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "./dist/server/entry.mjs"]
