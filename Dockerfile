FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build && ls -la dist/ && echo "Build completed successfully"

FROM node:20-alpine

WORKDIR /app

# CA НУЦ Минцифры (нужны для HTTPS к platform-api2.max.ru).
# Только .crt в репо (*.pem в .gitignore) — bundle собираем при сборке.
RUN apk add --no-cache ca-certificates \
  && mkdir -p /certs /usr/local/share/ca-certificates

COPY certs/russian_trusted_root_ca_pem.crt /usr/local/share/ca-certificates/russian_trusted_root_ca.crt
COPY certs/russian_trusted_sub_ca_pem.crt /usr/local/share/ca-certificates/russian_trusted_sub_ca.crt

RUN sed -i 's/\r$//' \
      /usr/local/share/ca-certificates/russian_trusted_root_ca.crt \
      /usr/local/share/ca-certificates/russian_trusted_sub_ca.crt \
  && cat \
      /usr/local/share/ca-certificates/russian_trusted_root_ca.crt \
      /usr/local/share/ca-certificates/russian_trusted_sub_ca.crt \
      > /certs/russian_trusted_ca_bundle.pem \
  && update-ca-certificates \
  && test -s /etc/ssl/certs/ca-certificates.crt \
  && test -s /certs/russian_trusted_ca_bundle.pem

ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt

COPY package.json yarn.lock ./
RUN yarn install --production --frozen-lockfile

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets

RUN mkdir -p /app/sessions

ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}

CMD ["node", "dist/main"]
