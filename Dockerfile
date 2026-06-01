FROM node:24-alpine AS frontend-build
WORKDIR /frontend
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN apk add --no-cache zip
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY frontend .
COPY VERSION /VERSION
ARG VITE_API_URL=/api/v1
ARG VITE_VERSION_SUFFIX=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_VERSION_SUFFIX=$VITE_VERSION_SUFFIX
# Browser SPA build (base "/") served by the backend at /app/static.
RUN pnpm run build
# Capacitor-flavored OTA bundle (base "", __IS_CAPACITOR__=true) shipped at /app/ota so the
# native app can download the web bundle matching this backend version. build:capacitor
# overwrites dist/, so stash the browser build first, then zip the capacitor build with
# index.html at the zip root (cd dist before zipping — do NOT nest under dist/).
RUN cp -r dist /tmp/browser-dist \
 && pnpm build:capacitor \
 && mkdir -p /ota \
 && (cd dist && zip -qr /ota/bundle.zip .) \
 && sha256sum /ota/bundle.zip | cut -d' ' -f1 > /ota/bundle.sha256 \
 && rm -rf dist && mv /tmp/browser-dist dist

FROM python:3.12-slim AS backend-runtime
ARG VERSION=0.1.0
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.title="Initiative"
LABEL org.opencontainers.image.description="Initiative project management application"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY VERSION ./VERSION
COPY MIN_NATIVE_VERSION ./MIN_NATIVE_VERSION
COPY CHANGELOG.md ./CHANGELOG.md
COPY --from=frontend-build /frontend/dist ./static
COPY --from=frontend-build /ota/bundle.zip ./ota/bundle.zip
COPY --from=frontend-build /ota/bundle.sha256 ./ota/bundle.sha256
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/uploads
COPY backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["sh", "start.sh"]
