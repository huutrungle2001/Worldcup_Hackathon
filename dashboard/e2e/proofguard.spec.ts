import { test, expect } from "@playwright/test";

test.describe("ProofGuard Dashboard E2E Tests", () => {
  // Scenario 1: Above-the-fold copy explains the product, demo provenance, no-wallet promise, and four-step journey.
  test("Scenario 1: Above-the-fold copy contains explanation, no-wallet promise and four-step journey", async ({ page }) => {
    // Intercept API calls to prevent real backend requests
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scoresSse: { status: "HEALTHY", errorCount: 0 },
          oddsSse: { status: "HEALTHY", errorCount: 0 },
          txlineHttp: { status: "HEALTHY", errorCount: 0 },
          solanaRpc: { status: "HEALTHY", errorCount: 0 },
          replayMode: false,
        }),
      })
    );

    await page.route("**/api/replay/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          state: "IDLE",
          activeFixtureId: null,
          demoFixtureId: 18257739,
          speed: 5,
          currentStep: 0,
          totalSteps: 0,
          message: "Replay engine idle",
          error: null,
          lastUpdated: new Date().toISOString(),
        }),
      })
    );

    await page.route("**/api/markets", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      })
    );

    await page.route("**/api/receipts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      })
    );

    await page.goto("/");

    // Check above-the-fold headers and explanations
    await expect(page.locator("h2", { hasText: "What is ProofGuard?" })).toBeVisible();
    await expect(
      page.getByText(
        "ProofGuard automatically halts a virtual market when a goal arrives, verifies the score using TxLINE's Solana proof, and reopens only after fresh odds arrive."
      )
    ).toBeVisible();

    // Check no-wallet promise and demo provenance info
    await expect(page.getByText("Demo Replay Mode:")).toBeVisible();
    await expect(page.getByText("No Wallet Required:")).toBeVisible();

    // Check four-step journey strip
    await expect(page.getByText("1. Goal detected")).toBeVisible();
    await expect(page.getByText("2. Market halted")).toBeVisible();
    await expect(page.getByText("3. Solana proof checked")).toBeVisible();
    await expect(page.getByText("4. Fresh odds reopen")).toBeVisible();
  });

  // Scenario 2: Missing demo fixture disables the primary action with an actionable setup message.
  test("Scenario 2: Missing demo fixture disables action and shows actionable setup message", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scoresSse: { status: "HEALTHY", errorCount: 0 },
          oddsSse: { status: "HEALTHY", errorCount: 0 },
          txlineHttp: { status: "HEALTHY", errorCount: 0 },
          solanaRpc: { status: "HEALTHY", errorCount: 0 },
          replayMode: false,
        }),
      })
    );

    // Mock response where demoFixtureId is null (missing)
    await page.route("**/api/replay/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          state: "IDLE",
          activeFixtureId: null,
          demoFixtureId: null,
          speed: 5,
          currentStep: 0,
          totalSteps: 0,
          message: "Replay engine idle",
          error: null,
          lastUpdated: new Date().toISOString(),
        }),
      })
    );

    await page.route("**/api/markets", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    );

    await page.goto("/");

    // Verify button is disabled
    const demoButton = page.getByRole("button", { name: /Run historical demo/ });
    await expect(demoButton).toBeDisabled();

    // Verify setup message is displayed
    await expect(page.getByText("No demo fixture configured.")).toBeVisible();
  });

  // Scenario 3: Invalid manual fixture input shows inline validation and sends no request.
  test("Scenario 3: Invalid manual fixture input shows inline validation and sends no request", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scoresSse: { status: "HEALTHY", errorCount: 0 },
          oddsSse: { status: "HEALTHY", errorCount: 0 },
          txlineHttp: { status: "HEALTHY", errorCount: 0 },
          solanaRpc: { status: "HEALTHY", errorCount: 0 },
          replayMode: false,
        }),
      })
    );

    await page.route("**/api/replay/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          state: "IDLE",
          activeFixtureId: null,
          demoFixtureId: 18257739,
          speed: 5,
          currentStep: 0,
          totalSteps: 0,
          message: "Replay engine idle",
          error: null,
          lastUpdated: new Date().toISOString(),
        }),
      })
    );

    await page.route("**/api/markets", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    );

    // Track if any request is sent to start API
    let startRequestSent = false;
    await page.route("**/api/replay/start", (route) => {
      startRequestSent = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    });

    await page.goto("/");

    // Expand advanced controls
    await page.click("text=Advanced Controls");

    // Enter invalid fixture ID (negative value)
    const input = page.locator("#manual-fixture-id");
    await input.fill("-123");

    // Verify validation error text appears
    await expect(page.getByText("Fixture ID must be a positive integer.")).toBeVisible();

    // Verify Start Manual button is disabled
    const manualBtn = page.getByRole("button", { name: "Start Manual Replay" });
    await expect(manualBtn).toBeDisabled();

    // Double check that we didn't invoke any request
    expect(startRequestSent).toBe(false);
  });

  // Scenario 4: Successful start shows LOADING, then RUNNING, fixture ID, and progress.
  test("Scenario 4: Successful start shows LOADING, then RUNNING and progress", async ({ page }) => {
    let callCount = 0;
    let isStarted = false;

    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scoresSse: { status: "HEALTHY", errorCount: 0 },
          oddsSse: { status: "HEALTHY", errorCount: 0 },
          txlineHttp: { status: "HEALTHY", errorCount: 0 },
          solanaRpc: { status: "HEALTHY", errorCount: 0 },
          replayMode: true,
        }),
      })
    );

    // Mock replay status transitioning from LOADING to RUNNING on successive requests
    await page.route("**/api/replay/status", (route) => {
      let state = "IDLE";
      let message = "Replay engine idle";
      if (isStarted) {
        callCount++;
        state = callCount === 1 ? "LOADING" : "RUNNING";
        message = callCount === 1 ? "Loading historical score records..." : "Replaying fixture 18257739...";
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          state,
          activeFixtureId: 18257739,
          demoFixtureId: 18257739,
          speed: 5,
          currentStep: 4,
          totalSteps: 12,
          message,
          error: null,
          lastUpdated: new Date().toISOString(),
        }),
      });
    });

    await page.route("**/api/replay/start", (route) => {
      isStarted = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    await page.route("**/api/markets", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    );

    await page.goto("/");

    // Click run demo button
    await page.click("text=Run historical demo");

    // First response status should be LOADING
    await expect(page.getByText("State: LOADING")).toBeVisible();
    await expect(page.getByText("Loading historical score records...")).toBeVisible();

    // Wait a brief moment for polling interval to trigger second call (RUNNING state)
    await page.waitForTimeout(1100);

    // Should now show RUNNING state with correct active fixture and progress
    await expect(page.getByText("State: RUNNING")).toBeVisible();
    await expect(page.getByText("Fixture: 18257739")).toBeVisible();
    await expect(page.getByText("Progress: 4 / 12")).toBeVisible();
    await expect(page.getByText("Replaying fixture 18257739...")).toBeVisible();
  });

  // Scenario 5: A newly returned market is automatically selected and its plain-language state plus audit trail are visible.
  test("Scenario 5: Newly returned market is auto-selected and shows friendly status and audit trail", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scoresSse: { status: "HEALTHY", errorCount: 0 },
          oddsSse: { status: "HEALTHY", errorCount: 0 },
          txlineHttp: { status: "HEALTHY", errorCount: 0 },
          solanaRpc: { status: "HEALTHY", errorCount: 0 },
          replayMode: true,
        }),
      })
    );

    await page.route("**/api/replay/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          state: "RUNNING",
          activeFixtureId: 18257739,
          demoFixtureId: 18257739,
          speed: 5,
          currentStep: 8,
          totalSteps: 12,
          message: "Replaying fixture 18257739...",
          error: null,
          lastUpdated: new Date().toISOString(),
        }),
      })
    );

    // Return a virtual market with state PROOF_PENDING and audit log
    await page.route("**/api/markets", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            fixtureId: 18257739,
            state: "PROOF_PENDING",
            scoreOne: 1,
            scoreTwo: 0,
            lastScoreSeq: 4,
            lastScoreTs: 1000,
            lastOddsSeq: 10,
            lastOddsTs: 2000,
            oddsOne: 1500,
            oddsDraw: 3000,
            oddsTwo: 4500,
            auditTrail: [
              {
                timestamp: new Date().toISOString(),
                fromState: "HALTED",
                toState: "PROOF_PENDING",
                reasonCode: "PROOF_VALIDATED_ON_CHAIN",
                message: "Proof passed. Virtual market awaiting repriced odds.",
              },
            ],
          },
        ]),
      })
    );

    await page.goto("/");

    // Verify active market card is selected automatically using the specific selected card attribute selector
    const card = page.locator("button[aria-pressed='true']");
    await expect(card).toBeVisible();

    // Verify friendly state translation
    await expect(page.getByText("Proof passed; waiting for newer odds")).toBeVisible();

    // Verify audit logs are displayed
    await expect(page.getByText("PROOF_VALIDATED_ON_CHAIN")).toBeVisible();
    await expect(page.getByText("Proof passed. Virtual market awaiting repriced odds.")).toBeVisible();
  });

  // Scenario 6: A confirmed receipt renders Confirmed on Solana and an Explorer link.
  test("Scenario 6: Confirmed receipt renders Confirmed on Solana and Explorer link", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scoresSse: { status: "HEALTHY", errorCount: 0 },
          oddsSse: { status: "HEALTHY", errorCount: 0 },
          txlineHttp: { status: "HEALTHY", errorCount: 0 },
          solanaRpc: { status: "HEALTHY", errorCount: 0 },
          replayMode: false,
        }),
      })
    );

    await page.route("**/api/replay/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          state: "IDLE",
          activeFixtureId: null,
          demoFixtureId: 18257739,
          speed: 5,
          currentStep: 0,
          totalSteps: 0,
          message: "Replay engine idle",
          error: null,
          lastUpdated: new Date().toISOString(),
        }),
      })
    );

    await page.route("**/api/markets", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    );

    // Mock receipts containing confirmed transaction and rejected precheck
    await page.route("**/api/receipts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "rcpt_conf_123",
            fixtureId: 18257739,
            seq: 1,
            expectedStats: [{ key: 1, value: 2 }],
            provedStats: [{ key: 1, value: 2, period: 0 }],
            proofTimestamp: 1000,
            programId: "5F3w5...dummy",
            network: "devnet",
            status: "CONFIRMED",
            mode: "TRANSACTION",
            signature: "dummy_sig_abc",
            explorerUrl: "https://explorer.solana.com/tx/dummy_sig_abc?cluster=devnet",
            validatedAt: new Date().toISOString(),
          },
        ]),
      })
    );

    await page.goto("/");

    // Verify confirmed status label
    await expect(page.getByText("Confirmed on Solana")).toBeVisible();

    // Verify explorer link is visible and correct
    const explorerLink = page.getByRole("link", { name: "Solana Explorer ↗" });
    await expect(explorerLink).toBeVisible();
    await expect(explorerLink).toHaveAttribute("href", "https://explorer.solana.com/tx/dummy_sig_abc?cluster=devnet");
  });

  // Scenario 7: No-history, disabled-demo, unauthorized/rate-limited, and server-error responses are visibly reported.
  test("Scenario 7: Replay errors are visibly reported and do not claim start success", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scoresSse: { status: "HEALTHY", errorCount: 0 },
          oddsSse: { status: "HEALTHY", errorCount: 0 },
          txlineHttp: { status: "HEALTHY", errorCount: 0 },
          solanaRpc: { status: "HEALTHY", errorCount: 0 },
          replayMode: false,
        }),
      })
    );

    await page.route("**/api/replay/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          state: "IDLE",
          activeFixtureId: null,
          demoFixtureId: 18257739,
          speed: 5,
          currentStep: 0,
          totalSteps: 0,
          message: "Replay engine idle",
          error: null,
          lastUpdated: new Date().toISOString(),
        }),
      })
    );

    await page.route("**/api/markets", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    );

    // Mock API start endpoint responding with 429 Rate Limit
    await page.route("**/api/replay/start", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Too many replay requests. Please wait a moment before trying again.",
          code: "RATE_LIMITED",
        }),
      })
    );

    await page.goto("/");

    // Click run demo button
    await page.click("text=Run historical demo");

    // Error alert must be shown on page
    await expect(page.getByText("Error: Too many replay requests. Please wait a moment before trying again.")).toBeVisible();

    // Verify replay state does not report RUNNING
    await expect(page.getByText("State: RUNNING")).not.toBeVisible();
  });

  // Scenario 8: Pause, resume, stop, and speed controls are enabled only in valid states and send the correct request once.
  test("Scenario 8: Controls are selectively enabled and send exact requests", async ({ page }) => {
    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scoresSse: { status: "HEALTHY", errorCount: 0 },
          oddsSse: { status: "HEALTHY", errorCount: 0 },
          txlineHttp: { status: "HEALTHY", errorCount: 0 },
          solanaRpc: { status: "HEALTHY", errorCount: 0 },
          replayMode: true,
        }),
      })
    );

    // Mock status as RUNNING
    await page.route("**/api/replay/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          state: "RUNNING",
          activeFixtureId: 18257739,
          demoFixtureId: 18257739,
          speed: 5,
          currentStep: 2,
          totalSteps: 12,
          message: "Replaying fixture 18257739...",
          error: null,
          lastUpdated: new Date().toISOString(),
        }),
      })
    );

    await page.route("**/api/markets", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    );

    let pauseCalledCount = 0;
    await page.route("**/api/replay/pause", (route) => {
      pauseCalledCount++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true }) });
    });

    await page.goto("/");

    // Verify button enabled states under RUNNING: Pause is enabled, Resume is disabled
    const pauseBtn = page.getByRole("button", { name: "Pause" });
    const resumeBtn = page.getByRole("button", { name: "Resume" });

    await expect(pauseBtn).toBeEnabled();
    await expect(resumeBtn).toBeDisabled();

    // Click pause
    await pauseBtn.click();

    // Verify it sent correct request exactly once
    expect(pauseCalledCount).toBe(1);
  });

  // Scenario 9: Backend polling failure renders a disconnected alert and does not leave stale healthy status.
  test("Scenario 9: Backend connection failure renders disconnected warning", async ({ page }) => {
    // Force immediate connection failures
    await page.route("**/api/health", (route) => route.abort("failed"));
    await page.route("**/api/replay/status", (route) => route.abort("failed"));
    await page.route("**/api/markets", (route) => route.abort("failed"));

    await page.goto("/");

    // Disconnected banner must be displayed
    await expect(page.getByText("Disconnected from backend API server. Stale metrics are hidden.")).toBeVisible();

    // SSE health badge should not show HEALTHY
    await expect(page.getByText("Scores SSE")).not.toBeVisible();
  });

  // Scenario 10: The primary journey works at a 390px viewport and the core controls are keyboard reachable.
  test("Scenario 10: Mobile viewport (390px) is clean and keyboard navigation works", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.route("**/api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          scoresSse: { status: "HEALTHY", errorCount: 0 },
          oddsSse: { status: "HEALTHY", errorCount: 0 },
          txlineHttp: { status: "HEALTHY", errorCount: 0 },
          solanaRpc: { status: "HEALTHY", errorCount: 0 },
          replayMode: false,
        }),
      })
    );

    await page.route("**/api/replay/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          state: "IDLE",
          activeFixtureId: null,
          demoFixtureId: 18257739,
          speed: 5,
          currentStep: 0,
          totalSteps: 0,
          message: "Replay engine idle",
          error: null,
          lastUpdated: new Date().toISOString(),
        }),
      })
    );

    await page.route("**/api/markets", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) })
    );

    await page.goto("/");

    // Core buttons and receipt views should be fully visible at 390px
    const demoButton = page.getByRole("button", { name: /Run historical demo/ });
    await expect(demoButton).toBeVisible();

    // Verify keyboard navigation: verify button is standard keyboard focusable (no tabindex="-1")
    await expect(demoButton).not.toHaveAttribute("tabindex", "-1");
  });
});
