FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY *.js *.json ./
ENV NODE_ENV=production PORT=7000
EXPOSE 7000
CMD ["node", "server.js"]
