import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { availabilityFingerprint } from "./monitor-state.mjs";
import { autofillBookingForm } from "./form-autofill.mjs";

const TIME_LABEL = /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i;
const DISCOVERY_CLICK_TIMEOUT_MS = 5_000;
const SUBMISSION_CONFIRM_TIMEOUT_MS = 15_000;
const MAX_SLOT_ATTEMPTS = 8;
const UNAVAILABLE_SUBMISSION_CODES = new Set([
  "INTENT_UNAVAILABLE_TIME_SLOT",
  "BOOKING_SLOT_UNAVAILABLE",
]);

export function shouldCaptureDiscovery(availableDates, previousState) {
  if (availableDates.length === 0) return false;
  return (
    previousState.status !== "available" ||
    previousState.fingerprint !== availabilityFingerprint(availableDates)
  );
}

export function sanitizedNetworkUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return {
      origin: url.origin,
      pathname: url.pathname
        .split("/")
        .map((segment) =>
          segment.length >= 48 ||
          /^(?:itt|bkg|bok)_[0-9a-z-]+$/i.test(segment)
            ? "[redacted-segment]"
            : segment,
        )
        .join("/"),
      queryKeys: [...new Set(url.searchParams.keys())].sort(),
    };
  } catch {
    return { origin: null, pathname: "[invalid-url]", queryKeys: [] };
  }
}

function fileSafeTimestamp(date) {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function attachNetworkRecorder(page, bookingUrl) {
  const bookingOrigin = new URL(bookingUrl).origin;
  const events = [];
  const push = (event) => {
    if (events.length < 500) events.push(event);
  };

  page.on("request", (request) => {
    const url = sanitizedNetworkUrl(request.url());
    if (url.origin !== bookingOrigin) return;
    push({
      event: "request",
      at: new Date().toISOString(),
      method: request.method(),
      resourceType: request.resourceType(),
      url,
    });
  });

  page.on("response", (response) => {
    const url = sanitizedNetworkUrl(response.url());
    if (url.origin !== bookingOrigin) return;
    push({
      event: "response",
      at: new Date().toISOString(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      status: response.status(),
      url,
    });
  });

  return events;
}

async function sanitizedHtml(page) {
  return page.evaluate(() => {
    const root = document.documentElement.cloneNode(true);

    const sanitizedUrl = (rawValue) => {
      try {
        const url = new URL(rawValue, location.href);
        if (!/^https?:$/.test(url.protocol)) return "[removed-url]";
        url.pathname = url.pathname
          .split("/")
          .map((segment) =>
            segment.length >= 48 ||
            /^(?:itt|bkg|bok)_[0-9a-z-]+$/i.test(segment)
              ? "[redacted-segment]"
              : segment,
          )
          .join("/");
        const queryKeys = [...new Set(url.searchParams.keys())].sort();
        url.search = "";
        for (const key of queryKeys) url.searchParams.append(key, "[redacted]");
        url.hash = "";
        return url.toString();
      } catch {
        return "[removed-url]";
      }
    };

    root.querySelectorAll("script").forEach((script) => {
      if (!script.src) script.textContent = "/* inline script removed */";
    });

    root.querySelectorAll("input, textarea, select, option").forEach((field) => {
      field.removeAttribute("value");
      field.removeAttribute("checked");
      field.removeAttribute("selected");
      if (field.tagName === "TEXTAREA") field.textContent = "";
    });

    root.querySelectorAll("*").forEach((element) => {
      for (const attribute of [...element.attributes]) {
        if (/token|secret|authorization|captcha-response/i.test(attribute.name)) {
          element.removeAttribute(attribute.name);
        } else if (/^(?:href|src|action|formaction|poster)$/i.test(attribute.name)) {
          element.setAttribute(attribute.name, sanitizedUrl(attribute.value));
        }
      }
    });

    return `<!doctype html>\n${root.outerHTML}`;
  });
}

async function pageStructure(page) {
  return page.evaluate(() => {
    const text = (element) =>
      (element?.getAttribute("aria-label") || element?.textContent || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 300);

    const labelFor = (field) => {
      if (field.id) {
        const explicit = document.querySelector(
          `label[for="${CSS.escape(field.id)}"]`,
        );
        if (explicit) return text(explicit);
      }
      return text(field.closest("label"));
    };

    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const safeUrl = (rawValue) => {
      try {
        const url = new URL(rawValue, location.href);
        return {
          origin: url.origin,
          pathname: url.pathname
            .split("/")
            .map((segment) =>
              segment.length >= 48 ||
              /^(?:itt|bkg|bok)_[0-9a-z-]+$/i.test(segment)
                ? "[redacted-segment]"
                : segment,
            )
            .join("/"),
          queryKeys: [...new Set(url.searchParams.keys())].sort(),
        };
      } catch {
        return { origin: null, pathname: "[invalid-url]", queryKeys: [] };
      }
    };

    return {
      url: safeUrl(location.href),
      title: document.title,
      headings: [...document.querySelectorAll("h1, h2, h3")]
        .map(text)
        .filter(Boolean)
        .slice(0, 50),
      forms: [...document.forms].slice(0, 10).map((form, index) => ({
        index,
        method: form.method,
        action: form.action ? safeUrl(form.action) : null,
      })),
      fields: [
        ...document.querySelectorAll("input, textarea, select"),
      ]
        .slice(0, 150)
        .map((field) => ({
          tag: field.tagName.toLowerCase(),
          type: field.getAttribute("type"),
          name: field.getAttribute("name"),
          id: field.id || null,
          label: labelFor(field) || null,
          placeholder: field.getAttribute("placeholder"),
          autocomplete: field.getAttribute("autocomplete"),
          required: field.required,
          disabled: field.disabled,
          visible: visible(field),
          testId: field.getAttribute("data-testid"),
        })),
      buttons: [...document.querySelectorAll("button")]
        .slice(0, 150)
        .map((button) => ({
          text: text(button),
          type: button.type,
          disabled: button.disabled,
          ariaDisabled: button.getAttribute("aria-disabled"),
          visible: visible(button),
          id: button.id || null,
          testId: button.getAttribute("data-testid"),
        })),
      links: [...document.querySelectorAll("a[href]")]
        .slice(0, 100)
        .map((link) => ({
          text: text(link),
          url: safeUrl(link.href),
        })),
    };
  });
}

async function captureStage(page, directory, stage) {
  await writeFile(resolve(directory, `${stage}.html`), await sanitizedHtml(page));
  await writeJson(
    resolve(directory, `${stage}.structure.json`),
    await pageStructure(page),
  );
  await page.screenshot({
    path: resolve(directory, `${stage}.png`),
    fullPage: true,
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(750);
}

async function submitBookingForm(page, enabled, autofill) {
  const result = {
    enabled,
    attempted: false,
    confirmed: false,
    status: enabled ? "not-ready" : "disabled",
    safeToRetry: false,
    observedResponses: [],
  };
  if (!enabled || !autofill?.readyToSubmit) return result;

  let resolveOutcome;
  const serverOutcome = new Promise((resolve) => {
    resolveOutcome = resolve;
  });
  const responseHandler = async (response) => {
    const url = new URL(response.url());
    const method = response.request().method();
    if (
      url.origin !== "https://api.youcanbook.me" ||
      !url.pathname.startsWith("/v1/intents/") ||
      !["GET", "PATCH", "POST"].includes(method)
    ) {
      return;
    }

    const summary = {
      method,
      status: response.status(),
      url: sanitizedNetworkUrl(response.url()),
      intentStatus: null,
      errorCode: null,
      hasBookingId: false,
    };
    try {
      const body = await response.json();
      summary.intentStatus =
        typeof body?.intentStatus === "string" ? body.intentStatus : null;
      summary.hasBookingId = Boolean(body?.bookingId);
      const serializedBody = JSON.stringify(body);
      summary.errorCode = [...UNAVAILABLE_SUBMISSION_CODES].find((code) =>
        serializedBody.includes(code),
      ) || null;
    } catch {
      // Some intent responses have no JSON body. The status and URL are still
      // useful, while request/response bodies are deliberately never saved.
    }
    if (result.observedResponses.length < 30) {
      result.observedResponses.push(summary);
    }
    if (summary.hasBookingId) resolveOutcome("confirmed");
    if (summary.errorCode) resolveOutcome("unavailable");
  };

  page.on("response", responseHandler);
  try {
    const button = page.getByTestId("confirm_button");
    if ((await button.count()) !== 1 || !(await button.isVisible())) {
      result.status = "button-missing";
      return result;
    }
    if (!(await button.isEnabled())) {
      result.status = "button-disabled";
      return result;
    }
    const formValid = await button.evaluate((element) => {
      const form = element.closest("form");
      return !form || form.checkValidity();
    });
    if (!formValid) {
      result.status = "form-invalid";
      return result;
    }

    result.attempted = true;
    await button.click({ timeout: DISCOVERY_CLICK_TIMEOUT_MS });
    const unavailableInPage = page
      .waitForFunction(
        () => {
          const text = document.body.innerText;
          return /(?:time selected.*not available anymore|sorry, the time is not available|not enough units available)/i.test(
            text,
          );
        },
        undefined,
        { timeout: SUBMISSION_CONFIRM_TIMEOUT_MS },
      )
      .then(() => "unavailable")
      .catch(() => null);
    const outcome = await Promise.race([
      serverOutcome,
      unavailableInPage,
      page.waitForTimeout(SUBMISSION_CONFIRM_TIMEOUT_MS).then(() => null),
    ]);
    result.confirmed = outcome === "confirmed";
    result.status = outcome || "uncertain";
    result.safeToRetry = outcome === "unavailable";
  } catch (error) {
    result.status = "click-failed";
    result.error = error.message;
  } finally {
    page.off("response", responseHandler);
  }

  return result;
}

async function loadFreshCalendar(page, bookingUrl) {
  await page.goto(bookingUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const calendar = page.getByRole("grid");
  await calendar.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const grid = document.querySelector('[role="grid"]');
      const buttons = grid
        ? [...grid.querySelectorAll('button[data-testid^="day_"]')]
        : [];
      return (
        buttons.length > 0 &&
        buttons.every((button) => button.dataset.loading !== "true")
      );
    },
    undefined,
    { timeout: 30_000 },
  );
  await dismissCookieConsent(page);
}

async function selectNextSlot({
  page,
  bookingUrl,
  dateOptions,
  attemptedSlotIds,
  useCurrentCalendar,
}) {
  for (let index = 0; index < dateOptions.length; index += 1) {
    if (!useCurrentCalendar || index > 0) {
      await loadFreshCalendar(page, bookingUrl);
    }
    useCurrentCalendar = false;

    const date = dateOptions[index];
    const dateButton = page.getByTestId(date.testId);
    if (
      (await dateButton.count()) !== 1 ||
      !(await dateButton.isEnabled()) ||
      !(await dateButton.isVisible())
    ) {
      continue;
    }
    await dateButton.click({ timeout: DISCOVERY_CLICK_TIMEOUT_MS });
    await settle(page);

    const times = await availableTimeCandidates(page);
    const time = times.find(
      (candidate) => {
        const key = `${date.testId}|${candidate.testId || candidate.label}`;
        return !attemptedSlotIds.has(key);
      },
    );
    if (time) return { date, time, times };
  }
  return null;
}

async function dismissCookieConsent(page) {
  const consent = page.getByTestId("cookie_consent");
  const visible = await consent
    .waitFor({ state: "visible", timeout: 1_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return false;

  const reject = consent.getByRole("button", {
    name: /^(?:reject|decline)$/i,
  });
  const button =
    (await reject.count()) === 1
      ? reject
      : consent.getByTestId("cookie_consent_accept");

  if ((await button.count()) !== 1) {
    throw new Error(
      "Cookie consent is visible, but no unique dismiss button was found",
    );
  }

  await button.click({ timeout: DISCOVERY_CLICK_TIMEOUT_MS });
  await consent.waitFor({
    state: "hidden",
    timeout: DISCOVERY_CLICK_TIMEOUT_MS,
  });
  return true;
}

async function availableTimeCandidates(page) {
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll("button")].map((button) => ({
      label: (
        button.getAttribute("aria-label") ||
        button.textContent ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim(),
      disabled:
        button.disabled || button.getAttribute("aria-disabled") === "true",
      visible:
        getComputedStyle(button).display !== "none" &&
        getComputedStyle(button).visibility !== "hidden" &&
        button.getBoundingClientRect().width > 0 &&
        button.getBoundingClientRect().height > 0,
      testId: button.getAttribute("data-testid"),
    })),
  );

  return buttons.filter(
    (button) =>
      !button.disabled && button.visible && TIME_LABEL.test(button.label),
  );
}

export async function captureAvailabilityFlow({
  page,
  artifactRoot,
  checkedAt,
  calendarResult,
  networkEvents,
  bookingProfile,
  autoSubmitBooking = false,
  bookingUrl = new URL(page.url()).origin,
}) {
  const directory = resolve(artifactRoot, fileSafeTimestamp(checkedAt));
  await mkdir(directory, { recursive: true });

  const manifest = {
    schemaVersion: 1,
    capturedAt: checkedAt.toISOString(),
    selectedDate: null,
    selectedTime: null,
    availableDates: calendarResult.availableDates,
    stages: [],
    stoppedBeforeSubmission: true,
    autofill: null,
    submission: null,
    attempts: [],
    cookieConsentDismissed: false,
  };

  try {
    manifest.cookieConsentDismissed = await dismissCookieConsent(page);
    await captureStage(page, directory, "01-calendar");
    manifest.stages.push("calendar");

    if (!calendarResult.availableDateOptions[0]?.testId) {
      throw new Error("Available date did not expose a stable data-testid");
    }
    const attemptedSlotIds = new Set();
    let useCurrentCalendar = true;
    for (let attempt = 1; attempt <= MAX_SLOT_ATTEMPTS; attempt += 1) {
      const slot = await selectNextSlot({
        page,
        bookingUrl,
        dateOptions: calendarResult.availableDateOptions,
        attemptedSlotIds,
        useCurrentCalendar,
      });
      useCurrentCalendar = false;
      if (!slot) {
        if (manifest.attempts.some((item) => item.submission.safeToRetry)) {
          manifest.submission = {
            enabled: autoSubmitBooking,
            attempted: true,
            confirmed: false,
            status: "all-candidates-unavailable",
            safeToRetry: true,
            observedResponses: manifest.attempts.flatMap(
              (item) => item.submission.observedResponses,
            ),
          };
        }
        break;
      }

      if (attempt === 1) {
        manifest.selectedDate = slot.date.label;
        manifest.availableTimes = slot.times;
        await captureStage(page, directory, "02-times");
        manifest.stages.push("times");
      }

      const timeButton = slot.time.testId
        ? page.getByTestId(slot.time.testId)
        : page.getByRole("button", { name: slot.time.label, exact: true });
      if ((await timeButton.count()) !== 1) {
        throw new Error("Available time selector was not unique");
      }
      await timeButton.click({ timeout: DISCOVERY_CLICK_TIMEOUT_MS });
      await settle(page);

      if (attempt === 1) {
        manifest.selectedTime = slot.time.label;
        await captureStage(page, directory, "03-form");
        manifest.stages.push("form");
      }

      const autofill = await autofillBookingForm(page, bookingProfile);
      const submission = await submitBookingForm(
        page,
        autoSubmitBooking,
        autofill,
      );
      manifest.autofill = autofill;
      manifest.submission = submission;
      manifest.attempts.push({
        attempt,
        selectedDate: slot.date.label,
        selectedTime: slot.time.label,
        slotTestId: slot.time.testId || null,
        autofill,
        submission,
      });

      if (!submission.safeToRetry) break;
      attemptedSlotIds.add(
        `${slot.date.testId}|${slot.time.testId || slot.time.label}`,
      );
    }
    manifest.stoppedBeforeSubmission = !manifest.attempts.some(
      (item) => item.submission.attempted,
    );
  } catch (error) {
    manifest.discoveryError = error.stack || error.message;
  } finally {
    await writeJson(resolve(directory, "network.json"), networkEvents);
    await writeJson(resolve(directory, "manifest.json"), manifest);
  }

  return {
    directory,
    stages: manifest.stages,
    selectedDate: manifest.selectedDate,
    selectedTime: manifest.selectedTime,
    autofill: manifest.autofill,
    submission: manifest.submission,
    attempts: manifest.attempts,
    cookieConsentDismissed: manifest.cookieConsentDismissed,
    error: manifest.discoveryError || null,
  };
}
