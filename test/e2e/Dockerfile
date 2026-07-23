# Keep the tag in sync with @playwright/test in package.json — the image
# pre-installs browsers for exactly that version, so no `playwright install`.
FROM mcr.microsoft.com/playwright:v1.61.1-noble
WORKDIR /e2e
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY playwright.config.ts helpers.ts ./
COPY specs ./specs
# Non-root (Trivy DS-0002); the image ships pwuser. The chown matters:
# playwright writes test-results/ and playwright-report/ into /e2e.
RUN chown -R pwuser:pwuser /e2e
USER pwuser
ENV CI=1
CMD ["npx", "playwright", "test"]
