FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/relay/package.json apps/relay/package.json
COPY packages/remote-protocol/package.json packages/remote-protocol/package.json
RUN npm ci --ignore-scripts --include-workspace-root=false --workspace=@betterc0de/relay --workspace=@betterc0de/remote-protocol
COPY apps/relay/tsconfig.json apps/relay/tsconfig.json
COPY apps/relay/src apps/relay/src
COPY packages/remote-protocol/tsconfig.json packages/remote-protocol/tsconfig.json
COPY packages/remote-protocol/src packages/remote-protocol/src
RUN npx tsc -p packages/remote-protocol && npx tsc -p apps/relay

FROM node:24-alpine
ENV NODE_ENV=production RELAY_HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build /app/apps/relay/dist ./dist
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY --from=build /app/packages/remote-protocol/package.json ./node_modules/@betterc0de/remote-protocol/package.json
COPY --from=build /app/packages/remote-protocol/dist ./node_modules/@betterc0de/remote-protocol/dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
