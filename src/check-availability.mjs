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
import { parseBookingProfile } from "./form-autofill.mjs";

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
    browserChannel: process.env.BROWSER_CHANNEL?.trim() || undefined,
    dryRun: process.env.DRY_RUN === "true",
    captureDiscovery: process.env.CAPTURE_DISCOVERY !== "false",
    discoveryArtifactRoot: resolve(
      process.env.DISCOVERY_ARTIFACT_DIR || ".artifacts/discovery",
    ),
    bookingProfile:
      process.env.AUTO_FILL_BOOKING === "true"
        ? parseBookingProfile(process.env.BOOKING_PROFILE_JSON)
        : null,
    // DRY_RUN must also prevent the irreversible booking click, not only ntfy.
    autoSubmitBooking:
      process.env.AUTO_SUBMIT_BOOKING === "true" &&
      process.env.DRY_RUN !== "true",
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

async function inspectCalendar(
  config,
  previousState,
  checkedAt,
  onCalendarInspected,
) {
  const browser = await chromium.launch({
    headless: config.headless,
    channel: config.browserChannel,
  });

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
    await onCalendarInspected(calendarResult);

    if (
      config.captureDiscovery &&
      (config.autoSubmitBooking ||
        shouldCaptureDiscovery(calendarResult.availableDates, previousState))
    ) {
      calendarResult.discovery = await captureAvailabilityFlow({
        page,
        artifactRoot: config.discoveryArtifactRoot,
        checkedAt,
        calendarResult,
        networkEvents,
        bookingProfile: config.bookingProfile,
        autoSubmitBooking: config.autoSubmitBooking,
        bookingUrl: config.bookingUrl,
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
    calendarResult.discovery?.autofill?.enabled
      ? `自动填写：已填写 ${calendarResult.discovery.autofill.filledFields.length} 项；验证题和最终提交未处理`
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

async function sendSubmissionNotification(config, submission) {
  if (config.dryRun) {
    console.log("DRY_RUN=true; submission-result notification was not sent.");
    return false;
  }

  const confirmed = submission.confirmed;
  const response = await fetch(config.ntfyBaseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      topic: config.ntfyTopic,
      title: confirmed ? "预约已自动提交并确认" : "自动提交结果需要确认",
      message: confirmed
        ? "服务端已返回预约编号。请检查确认邮件；自动提交现已锁定，不会重复预约。"
        : `程序已尝试提交，但未取得预约编号（${submission.status}）。请检查邮件或预约页面；自动提交现已锁定，避免重复提交。`,
      priority: 5,
      tags: confirmed ? ["white_check_mark", "calendar"] : ["warning", "calendar"],
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
  if (config.autoSubmitBooking && !config.bookingProfile) {
    throw new Error(
      "AUTO_SUBMIT_BOOKING=true requires AUTO_FILL_BOOKING=true and a non-empty BOOKING_PROFILE_JSON secret.",
    );
  }

  const checkedAt = new Date();
  const previousState = await readState(config.stateFile);
  if (config.autoSubmitBooking && previousState.bookingSubmission?.attemptedAt) {
    console.log(
      JSON.stringify(
        {
          checkedAt: checkedAt.toISOString(),
          skipped: "automatic-submission-locked",
          bookingSubmission: previousState.bookingSubmission,
        },
        null,
        2,
      ),
    );
    return;
  }

  let decision;
  let notified = false;
  let currentState = previousState;
  const calendarResult = await inspectCalendar(
    config,
    previousState,
    checkedAt,
    async (inspectedCalendar) => {
      decision = shouldNotify({
        availableDates: inspectedCalendar.availableDates,
        previousState,
        now: checkedAt,
        reminderHours: config.reminderHours,
      });

      if (decision.notify) {
        notified = await sendNtfyNotification(
          config,
          inspectedCalendar,
          decision.reason,
        );
      }

      // Persist notification metadata before discovery navigation. A slow or
      // failed discovery attempt must not cause the same alert to be sent by
      // the next run.
      currentState = nextState({
        availableDates: inspectedCalendar.availableDates,
        previousState,
        checkedAt,
        notified,
        fingerprint: decision.fingerprint,
      });
      await writeState(config.stateFile, currentState);
    },
  );

  const submission = calendarResult.discovery?.submission;
  if (submission?.attempted && !submission.safeToRetry) {
    currentState = {
      ...currentState,
      bookingSubmission: {
        attemptedAt: new Date().toISOString(),
        confirmed: submission.confirmed,
        status: submission.status,
      },
    };
    await writeState(config.stateFile, currentState);
    await sendSubmissionNotification(config, submission);
  } else if (submission?.safeToRetry) {
    console.log(
      "The selected slot became unavailable; no submission lock was saved so later slots/runs can retry.",
    );
  }

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
