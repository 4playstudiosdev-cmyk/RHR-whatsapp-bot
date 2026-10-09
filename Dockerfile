FROM node:18
WORKDIR /app

# Puppeteer's bundled Chromium needs these shared libraries, which the
# bare node:18 image doesn't ship — without them Chrome fails with
# "error while loading shared libraries: libnspr4.so: ...".
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
    libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "index.js"]
