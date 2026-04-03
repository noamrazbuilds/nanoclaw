# NanoClaw Agent Container
# Runs Claude Agent SDK in isolated Linux VM with browser automation
#
# Base: Ubuntu 24.04 (glibc 2.39) — required by gws CLI binary.
# Node 22 installed via nodesource. Previous base (node:22-slim / Debian 12)
# only had glibc 2.36 which broke gws write operations.

FROM ubuntu:24.04

# Prevent interactive prompts during apt install
ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js 22 from nodesource + system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends \
    nodejs \
    chromium-browser \
    fonts-liberation \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0t64 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2t64 \
    libpangocairo-1.0-0 \
    libcups2t64 \
    libdrm2 \
    libxshmfence1 \
    curl \
    espeak-ng \
    espeak-ng-data \
    ffmpeg \
    git \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/lib/x86_64-linux-gnu/espeak-ng-data /usr/share/espeak-ng-data

# Set Chromium path for agent-browser
ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Ensure node user/group exist at uid/gid 1000 (matching node:22-slim).
# Ubuntu 24.04 ships with an 'ubuntu' user at 1000 — remove it first.
RUN userdel -r ubuntu 2>/dev/null; groupdel ubuntu 2>/dev/null; \
    userdel -r node 2>/dev/null; groupdel node 2>/dev/null; \
    groupadd -g 1000 node && useradd -m -u 1000 -g node node

# Install agent-browser and claude-code globally
RUN npm install -g agent-browser @anthropic-ai/claude-code @googleworkspace/cli

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY agent-runner/package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY agent-runner/ ./

# Build TypeScript
RUN npm run build

# Install pdf-reader CLI
COPY skills/pdf-reader/pdf-reader /usr/local/bin/pdf-reader
RUN chmod +x /usr/local/bin/pdf-reader

# Install Piper TTS + voice model for /speak skill
RUN curl -sL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz | tar xz -C /opt \
    && ln -s /opt/piper/piper /usr/local/bin/piper \
    && mkdir -p /opt/piper/voices \
    && curl -sL -o /opt/piper/voices/en_US-lessac-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx \
    && curl -sL -o /opt/piper/voices/en_US-lessac-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

# Verify no glibc mismatches in installed binaries
RUN echo "=== Checking binary dependencies ===" \
    && for bin in /usr/local/bin/gws /opt/piper/piper; do \
         if [ -f "$bin" ]; then \
           echo "Checking $bin:"; \
           ldd "$bin" 2>&1 | grep "not found" && { echo "FAIL: $bin"; exit 1; } || echo "  OK"; \
         else \
           echo "SKIP: $bin not found"; \
         fi; \
       done \
    && echo "All binary dependencies satisfied"

# Create workspace directories
RUN mkdir -p /workspace/group /workspace/global /workspace/extra /workspace/ipc/messages /workspace/ipc/tasks /workspace/ipc/input

# Create entrypoint script
# Container input (prompt, group info) is passed via stdin JSON.
# Credentials are injected by the host's credential proxy — never passed here.
# Follow-up messages arrive via IPC files in /workspace/ipc/input/
RUN printf '#!/bin/bash\nset -e\ncd /app && npx tsc --outDir /tmp/dist 2>&1 >&2\nln -s /app/node_modules /tmp/dist/node_modules\nchmod -R a-w /tmp/dist\ncat > /tmp/input.json\nnode /tmp/dist/index.js < /tmp/input.json\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh

# Set ownership to node user (non-root) for writable directories
RUN chown -R node:node /workspace && chmod 777 /home/node

# Switch to non-root user (required for --dangerously-skip-permissions)
USER node

# Set working directory to group workspace
WORKDIR /workspace/group

# Entry point reads JSON from stdin, outputs JSON to stdout
ENTRYPOINT ["/app/entrypoint.sh"]
