# syntax=docker/dockerfile:1

FROM node:20-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:20-slim AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
 && npm install --omit=dev --no-audit --no-fund \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY server/ ./
COPY --from=web-build /app/web/dist /app/web/dist
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# /api/health sits behind basic auth, so the probe has to authenticate itself
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "const a='Basic '+Buffer.from((process.env.BASIC_AUTH_USER||'admin')+':'+(process.env.BASIC_AUTH_PASS||'change-me')).toString('base64');fetch('http://localhost:3000/api/health',{headers:{Authorization:a}}).then(r=>{if(!r.ok)throw r.status;process.exit(0)}).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
