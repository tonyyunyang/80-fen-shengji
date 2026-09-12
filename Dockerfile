FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY public ./public
COPY src ./src
COPY server ./server
COPY vendor ./vendor
COPY LICENSE NOTICE ./
ENV HOST=0.0.0.0 PORT=5173 EIGHTY_DATA_DIR=/tmp/eighty-data
USER node
EXPOSE 5173
CMD ["node", "server/index.js"]
