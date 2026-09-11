# Dockerfile cho frontend Next.js (build production rồi chạy next start).
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js "nướng" biến NEXT_PUBLIC_* vào bundle LÚC BUILD -> phải truyền qua build-arg.
# Mặc định là domain production; docker-compose.yml cũng truyền đúng giá trị này.
ARG NEXT_PUBLIC_API_BASE=https://erp.dosco.vn/api/v1
ARG NEXT_PUBLIC_ASSET_BASE=https://erp.dosco.vn
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_ASSET_BASE=$NEXT_PUBLIC_ASSET_BASE
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["npm", "start"]
