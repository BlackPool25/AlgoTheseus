# Frontend Dockerfile
#
# Production multi-stage build:
#   Stage 1 (build):  Vite build with Bun
#   Stage 2 (serve):  Static files via nginx

# ============================================================
# Stage 1 — Build
# ============================================================
FROM oven/bun:1-alpine AS build

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy frontend source and build
COPY . ./
RUN bun run build

# ============================================================
# Stage 2 — Serve (nginx)
# ============================================================
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
