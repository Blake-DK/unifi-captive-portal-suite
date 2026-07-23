# Same base as the app image, so no new base enters the runner's cache.
FROM node:24-alpine
WORKDIR /srv
COPY server.mjs .
USER node
EXPOSE 9080
CMD ["node", "server.mjs"]
