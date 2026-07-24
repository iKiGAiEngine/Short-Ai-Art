FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY providers ./providers
COPY public ./public
COPY data ./data
ENV NODE_ENV=production
EXPOSE 4173
CMD ["npm", "start"]
