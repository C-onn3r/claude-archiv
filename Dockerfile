# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
# PDF-Export braucht Chromium (~400 MB). Ohne: docker build --build-arg WITH_PDF=0 .
ARG WITH_PDF=1
RUN if [ "$WITH_PDF" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji \
      && rm -rf /var/lib/apt/lists/*; \
    fi
# Im Container ist die Chromium-Sandbox ohne zusätzliche Rechte nicht nutzbar; der Container selbst isoliert.
ENV PDF_NO_SANDBOX=1
ENV NODE_ENV=production \
    DATA_DIR=/data \
    FRONTEND_DIR=/app/frontend/dist \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev -w backend --include-workspace-root=false \
 && npm cache clean --force
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/backend
CMD ["node", "dist/index.js"]
