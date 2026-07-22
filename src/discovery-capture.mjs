import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { availabilityFingerprint } from "./monitor-state.mjs";

const TIME_LABEL = /\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i;

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
          segment.length >= 48 ? "[redacted-segment]" : segment,
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
            segment.length >= 48 ? "[redacted-segment]" : segment,
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

    return {
      url: location.href,
      title: document.title,
      headings: [...document.querySelectorAll("h1, h2, h3")]
        .map(text)
        .filter(Boolean)
        .slice(0, 50),
      forms: [...document.forms].slice(0, 10).map((form, index) => ({
        index,
        method: form.method,
        actionOrigin: form.action ? new URL(form.action).origin : null,
        actionPathname: form.action ? new URL(form.action).pathname : null,
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
          origin: new URL(link.href).origin,
          pathname: new URL(link.href).pathname,
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
  };

  try {
    await captureStage(page, directory, "01-calendar");
    manifest.stages.push("calendar");

    const firstDate = calendarResult.availableDateOptions[0];
    if (!firstDate?.testId) {
      throw new Error("Available date did not expose a stable data-testid");
    }

    const dateButton = page.locator(
      `button[data-testid="${firstDate.testId}"]`,
    );
    if ((await dateButton.count()) !== 1) {
      throw new Error("Available date selector was not unique");
    }
    await dateButton.click();
    manifest.selectedDate = firstDate.label;
    await settle(page);

    await captureStage(page, directory, "02-times");
    manifest.stages.push("times");

    const times = await availableTimeCandidates(page);
    manifest.availableTimes = times;
    const firstTime = times[0];
    if (!firstTime) {
      throw new Error("No enabled time button was identified after selecting a date");
    }

    const timeButton = page.getByRole("button", {
      name: firstTime.label,
      exact: true,
    });
    if ((await timeButton.count()) !== 1) {
      throw new Error("Available time selector was not unique");
    }
    await timeButton.click();
    manifest.selectedTime = firstTime.label;
    await settle(page);

    await captureStage(page, directory, "03-form");
    manifest.stages.push("form");
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
    error: manifest.discoveryError || null,
  };
}
