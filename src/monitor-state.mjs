import { createHash } from "node:crypto";

export const EMPTY_STATE = Object.freeze({
  schemaVersion: 1,
  status: "unknown",
  fingerprint: null,
  lastCheckedAt: null,
  lastNotifiedAt: null,
  lastNotifiedFingerprint: null,
});

export function availabilityFingerprint(dates) {
  return createHash("sha256")
    .update([...dates].sort().join("\n"))
    .digest("hex");
}

export function shouldNotify({
  availableDates,
  previousState,
  now,
  reminderHours,
}) {
  if (availableDates.length === 0) {
    return { notify: false, reason: "no-availability", fingerprint: null };
  }

  const fingerprint = availabilityFingerprint(availableDates);

  if (previousState.status !== "available") {
    return { notify: true, reason: "became-available", fingerprint };
  }

  if (previousState.lastNotifiedFingerprint !== fingerprint) {
    return { notify: true, reason: "availability-changed", fingerprint };
  }

  const lastNotifiedAt = Date.parse(previousState.lastNotifiedAt ?? "");
  const reminderMs = reminderHours * 60 * 60 * 1000;

  if (!Number.isFinite(lastNotifiedAt) || now.getTime() - lastNotifiedAt >= reminderMs) {
    return { notify: true, reason: "reminder-due", fingerprint };
  }

  return { notify: false, reason: "duplicate-suppressed", fingerprint };
}

export function nextState({
  availableDates,
  previousState,
  checkedAt,
  notified,
  fingerprint,
}) {
  const isAvailable = availableDates.length > 0;

  return {
    schemaVersion: 1,
    status: isAvailable ? "available" : "none",
    fingerprint: isAvailable ? fingerprint : null,
    lastCheckedAt: checkedAt.toISOString(),
    lastNotifiedAt: notified
      ? checkedAt.toISOString()
      : previousState.lastNotifiedAt,
    lastNotifiedFingerprint: notified
      ? fingerprint
      : previousState.lastNotifiedFingerprint,
  };
}
