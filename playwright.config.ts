import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides the environment directly.
}

// End-to-end tests run a production build against the LOCAL Supabase stack
// (`npm run db:start`, then `npm run env:local`). They reset the local
// database first and read emails from the local mail catcher. No external
// service is contacted.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000/sign-in",
    // Always build and serve the current code; never test a stale server.
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
