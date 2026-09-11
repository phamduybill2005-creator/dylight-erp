# Frontend Next.js — build production rồi chạy "next start" ở cổng 3000.
#
# NEXT_PUBLIC_* được Next.js "nướng" vào bundle LÚC BUILD (trình duyệt đọc),
# nên phải truyền bằng build-arg; đặt ở lúc chạy container là vô tác dụng.
# docker-compose.yml truyền giá trị production; mặc định bên dưới cũng vậy.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_BASE=https://erp.dosco.vn/api/v1
ARG NEXT_PUBLIC_ASSET_BASE=https://erp.dosco.vn
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE \
    NEXT_PUBLIC_ASSET_BASE=$NEXT_PUBLIC_ASSET_BASE \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
# Chạy bằng user "node" (không phải root). .next thuộc về node vì Next ghi
# cache tối ưu ảnh vào .next/cache lúc chạy.
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next ./.next
USER node
EXPOSE 3000
CMD ["npm", "start"]
