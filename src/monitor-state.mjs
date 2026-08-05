import { createHash } from "node:crypto";

export const SUBMISSION_LOCK_VERSION = 2;

export const EMPTY_STATE = Object.freeze({
  schemaVersion: 1,
  status: "unknown",
  fingerprint: null,
  lastCheckedAt: null,
  lastNotifiedAt: null,
  lastNotifiedFingerprint: null,
  bookingSubmission: null,
});

export function availabilityFingerprint(dates) {
  return createHash("sha256")
    .update([...dates].sort().join("\n"))
    .digest("hex");
}

export function hasActiveSubmissionLock(state) {
  return Boolean(
    state?.bookingSubmission?.attemptedAt &&
      state.bookingSubmission.version === SUBMISSION_LOCK_VERSION,
  );
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
  const lastNotifiedAt = Date.parse(previousState.lastNotifiedAt ?? "");
  const reminderMs = reminderHours * 60 * 60 * 1000;
  const sameAsLastNotification =
    previousState.lastNotifiedFingerprint === fingerprint;

  if (
    sameAsLastNotification &&
    Number.isFinite(lastNotifiedAt) &&
    now.getTime() - lastNotifiedAt < reminderMs
  ) {
    return { notify: false, reason: "duplicate-suppressed", fingerprint };
  }

  if (sameAsLastNotification) {
    return { notify: true, reason: "reminder-due", fingerprint };
  }

  if (previousState.status !== "available") {
    return { notify: true, reason: "became-available", fingerprint };
  }

  return { notify: true, reason: "availability-changed", fingerprint };
}

export function nextState({
  availableDates,
  previousState,
  checkedAt,
  notified,
  fingerprint,
  bookingSubmission = previousState.bookingSubmission,
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
    bookingSubmission,
  };
}
