FROM node:20-slim

# Install dependencies for Playwright and better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    build-essential \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Install Playwright Chromium
RUN npx playwright install chromium

# Copy source code
COPY . .

# Expose port
EXPOSE 8000

# Start the app
CMD ["node", "src/index.js"]
