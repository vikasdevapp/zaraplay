FROM node:20-alpine AS base
WORKDIR /app
# Prisma's query engine binary is dynamically linked against OpenSSL, which the base Alpine
# image doesn't include — needed both to generate the right engine (build stage) and to run
# it (runtime stage).
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma

EXPOSE 4000
CMD ["node", "dist/index.js"]
