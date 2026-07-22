import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

import {
  EMPTY_STATE,
  nextState,
  shouldNotify,
} from "./monitor-state.mjs";
import {
  attachNetworkRecorder,
  captureAvailabilityFlow,
  shouldCaptureDiscovery,
} from "./discovery-capture.mjs";

const DEFAULT_BOOKING_URL =
  "https://tecomel-traveltotaiwan.youcanbook.me/";

function positiveNumber(value, fallback, name) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function configFromEnvironment() {
  return {
    bookingUrl: process.env.BOOKING_URL || DEFAULT_BOOKING_URL,
    ntfyTopic: process.env.NTFY_TOPIC?.trim(),
    ntfyBaseUrl: (process.env.NTFY_BASE_URL || "https://ntfy.sh").replace(
      /\/$/,
      "",
    ),
    stateFile: resolve(process.env.STATE_FILE || ".state/availability.json"),
    reminderHours: positiveNumber(
      process.env.NOTIFY_REMINDER_HOURS,
      6,
      "NOTIFY_REMINDER_HOURS",
    ),
    navigationTimeoutMs: positiveNumber(
      process.env.NAVIGATION_TIMEOUT_MS,
      60_000,
      "NAVIGATION_TIMEOUT_MS",
    ),
    headless: process.env.HEADLESS !== "false",
    dryRun: process.env.DRY_RUN === "true",
    captureDiscovery: process.env.CAPTURE_DISCOVERY !== "false",
    discoveryArtifactRoot: resolve(
      process.env.DISCOVERY_ARTIFACT_DIR || ".artifacts/discovery",
    ),
  };
}

async function readState(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    return { ...EMPTY_STATE, ...state };
  } catch (error) {
    if (error.code === "ENOENT") return { ...EMPTY_STATE };
    console.warn(`Ignoring unreadable state file: ${error.message}`);
    return { ...EMPTY_STATE };
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporaryPath, path);
}

async function inspectCalendar(config, previousState, checkedAt) {
  const browser = await chromium.launch({ headless: config.headless });

  try {
    const page = await browser.newPage({
      locale: "en-AU",
      timezoneId: "Australia/Melbourne",
    });
    const networkEvents = attachNetworkRecorder(page, config.bookingUrl);

    await page.goto(config.bookingUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs,
    });

    const calendar = page.getByRole("grid");
    await calendar.waitFor({ state: "visible", timeout: config.navigationTimeoutMs });

    await page.waitForFunction(
      () => {
        const grid = document.querySelector('[role="grid"]');
        const dateButtons = grid
          ? Array.from(grid.querySelectorAll('button[data-testid^="day_"]'))
          : [];
        return (
          dateButtons.length > 0 &&
          dateButtons.every((button) => button.dataset.loading !== "true")
        );
      },
      undefined,
      { timeout: config.navigationTimeoutMs },
    );

    const calendarResult = await calendar.evaluate((grid) => {
      const dateButtons = Array.from(
        grid.querySelectorAll('button[data-testid^="day_"]'),
      );

      return {
        calendarLabel: grid.getAttribute("aria-label"),
        dateButtonCount: dateButtons.length,
        availableDateOptions: dateButtons
          .filter(
            (button) =>
              !button.disabled && button.getAttribute("aria-disabled") !== "true",
          )
          .map((button) => ({
            label: button.getAttribute("aria-label"),
            testId: button.getAttribute("data-testid"),
          }))
          .filter((option) => option.label),
      };
    });
    calendarResult.availableDates = calendarResult.availableDateOptions.map(
      (option) => option.label,
    );

    if (calendarResult.dateButtonCount === 0) {
      throw new Error(
        "The calendar loaded, but no date buttons were found. The booking page structure may have changed.",
      );
    }

    calendarResult.discovery = null;
    if (
      config.captureDiscovery &&
      shouldCaptureDiscovery(calendarResult.availableDates, previousState)
    ) {
      calendarResult.discovery = await captureAvailabilityFlow({
        page,
        artifactRoot: config.discoveryArtifactRoot,
        checkedAt,
        calendarResult,
        networkEvents,
      });
    }

    return calendarResult;
  } finally {
    await browser.close();
  }
}

async function sendNtfyNotification(config, calendarResult, reason) {
  if (config.dryRun) {
    console.log("DRY_RUN=true; notification was not sent.");
    return false;
  }

  if (!config.ntfyTopic) {
    throw new Error(
      "Availability was found, but NTFY_TOPIC is not configured. Add it as a GitHub Actions secret.",
    );
  }

  const message = [
    `可预约日期：${calendarResult.availableDates.join("、")}`,
    calendarResult.calendarLabel
      ? `日历：${calendarResult.calendarLabel}`
      : null,
    `提醒原因：${reason}`,
    calendarResult.discovery
      ? `页面资料：已保存 ${calendarResult.discovery.stages.join(" → ") || "部分"} 阶段的分析 artifact`
      : null,
    "请尽快打开预约页面确认。",
  ]
    .filter(Boolean)
    .join("\n");

  const response = await fetch(config.ntfyBaseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      topic: config.ntfyTopic,
      title: "发现入台旅游申请预约空位",
      message,
      priority: 5,
      tags: ["calendar", "warning"],
      click: config.bookingUrl,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `ntfy returned HTTP ${response.status}: ${await response.text()}`,
    );
  }

  return true;
}

async function main() {
  const config = configFromEnvironment();
  if (!config.dryRun && !config.ntfyTopic) {
    throw new Error(
      "NTFY_TOPIC is not configured. Add it as a GitHub Actions secret, or use DRY_RUN=true for a notification-free check.",
    );
  }

  const checkedAt = new Date();
  const previousState = await readState(config.stateFile);
  const calendarResult = await inspectCalendar(
    config,
    previousState,
    checkedAt,
  );
  const decision = shouldNotify({
    availableDates: calendarResult.availableDates,
    previousState,
    now: checkedAt,
    reminderHours: config.reminderHours,
  });

  let notified = false;
  if (decision.notify) {
    notified = await sendNtfyNotification(
      config,
      calendarResult,
      decision.reason,
    );
  }

  await writeState(
    config.stateFile,
    nextState({
      availableDates: calendarResult.availableDates,
      previousState,
      checkedAt,
      notified,
      fingerprint: decision.fingerprint,
    }),
  );

  console.log(
    JSON.stringify(
      {
        checkedAt: checkedAt.toISOString(),
        calendar: calendarResult.calendarLabel,
        available: calendarResult.availableDates.length > 0,
        availableDates: calendarResult.availableDates,
        discovery: calendarResult.discovery,
        notification: notified ? "sent" : decision.reason,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
