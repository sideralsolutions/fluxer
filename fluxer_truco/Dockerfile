# SPDX-License-Identifier: AGPL-3.0-or-later
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN rm -f src/*.test.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/health
CMD ["node", "src/server.mjs"]
