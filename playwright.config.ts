import { defineConfig, devices } from "@playwright/test";

const useExistingServer = process.env.PLAYWRIGHT_USE_EXISTING_SERVER === "1";
const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useExistingServer ? undefined : {
    command: `npm run build && npm start -- -p ${port}`,
    url: `${baseURL}/network/ngsl`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
