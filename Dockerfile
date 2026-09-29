FROM node:22-alpine AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.ts tsconfig.web.json ./
COPY web ./web
RUN npx vite build

FROM node:22-alpine

ARG RU_ROOT_CA_URL=https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt
ARG RU_ROOT_CA_SHA256=D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31

RUN apk add --no-cache openssl \
  && mkdir -p /etc/ssl/ru \
  && wget -qO /etc/ssl/ru/russian-trusted-root-ca.crt "$RU_ROOT_CA_URL" \
  && test "$(openssl x509 -in /etc/ssl/ru/russian-trusted-root-ca.crt -noout -fingerprint -sha256 | cut -d= -f2)" = "$RU_ROOT_CA_SHA256"

ENV NODE_ENV=production \
  PORT=3000 \
  NODE_EXTRA_CA_CERTS=/etc/ssl/ru/russian-trusted-root-ca.crt

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY --from=web /build/public ./public
RUN mkdir -p data && chown node:node data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO /dev/null http://127.0.0.1:3000/ || exit 1
CMD ["node", "src/main.ts"]
