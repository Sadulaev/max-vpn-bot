FROM node:20-alpine AS builder

WORKDIR /app

# Копируем package.json и yarn.lock
COPY package.json yarn.lock ./

# Устанавливаем зависимости через yarn
RUN yarn install --frozen-lockfile

COPY . .

# Собираем проект
RUN yarn build && ls -la dist/ && echo "Build completed successfully"

FROM node:20-alpine

WORKDIR /app

# Копируем package.json и yarn.lock для production
COPY package.json yarn.lock ./

# Устанавливаем только production зависимости
RUN yarn install --production --frozen-lockfile

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/assets ./assets

RUN mkdir -p /app/sessions

ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}

CMD ["node", "dist/main"]
