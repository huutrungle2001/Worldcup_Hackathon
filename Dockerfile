FROM node:20-slim

WORKDIR /app

# Install dependencies first
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# Copy codebase
COPY . .

# Expose port 8080 for the Express server
EXPOSE 8080

CMD ["yarn", "start"]
