# syntax=docker/dockerfile:1
#
# TinyGlob 容器镜像。三阶段构建:
#   deps    → 装依赖 + 生成 Prisma client(也供 migrate 服务复用)
#   builder → next build 产出 standalone 产物
#   runner  → 仅含运行所需文件的最小镜像
#
# 国内加速:npm 走 npmmirror、apt 走阿里云、Prisma 引擎走 npmmirror 二进制镜像。
# 基础镜像拉取由宿主机 docker daemon 的 registry-mirrors 负责,无需在此处理。

# ---------- deps:安装依赖 + 生成 Prisma client ----------
FROM node:18-slim AS deps

# apt 换阿里云源(bookworm 用 DEB822 的 .sources;兼容老版 sources.list)
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list 2>/dev/null; true
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# npm 走 npmmirror;Prisma 引擎从 npmmirror 二进制镜像下载
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
ENV PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
# 生成 Prisma client(从 PRISMA_ENGINES_MIRROR 拉 glibc 版引擎)
RUN npx prisma generate

# ---------- builder:next build(standalone) ----------
FROM node:18-slim AS builder

RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list 2>/dev/null; true
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- runner:最小生产镜像 ----------
FROM node:18-slim AS runner

RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list.d/debian.sources 2>/dev/null; \
    sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
        /etc/apt/sources.list 2>/dev/null; true
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# standalone 服务端 + 它追踪出来的最小 node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# 静态资源与 public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Prisma 生成的 client + engine 二进制:显式拷入,确保 standalone 里有
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
