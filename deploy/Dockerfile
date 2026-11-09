FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Optional reviewed data is supplied only by private release staging, never by the ordinary build context.
RUN mkdir -p /app/private-runtime && if [ -f /app/private-display-candidates.json ]; then cp /app/private-display-candidates.json /app/private-runtime/private-display-candidates.json && chmod 600 /app/private-runtime/private-display-candidates.json; fi
# These two values are public browser configuration. Never pass service keys as build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" && mkdir -p public && npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# tsx is required by the worker; retain the installed runtime and tool dependencies.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/private-runtime/ ./
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/tsconfig.json /app/next.config.ts ./
USER node
EXPOSE 3000
CMD ["sh", "-c", "exec ./node_modules/.bin/next start -H 0.0.0.0 -p \"${PORT:-3000}\""]
