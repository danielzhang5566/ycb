import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_STATE,
  availabilityFingerprint,
  nextState,
  shouldNotify,
} from "../src/monitor-state.mjs";

const now = new Date("2026-07-22T10:00:00.000Z");

test("does not notify when there is no availability", () => {
  const result = shouldNotify({
    availableDates: [],
    previousState: EMPTY_STATE,
    now,
    reminderHours: 6,
  });

  assert.equal(result.notify, false);
  assert.equal(result.reason, "no-availability");
});

test("notifies when availability first appears", () => {
  const result = shouldNotify({
    availableDates: ["Thursday 1 October 2026"],
    previousState: { ...EMPTY_STATE, status: "none" },
    now,
    reminderHours: 6,
  });

  assert.equal(result.notify, true);
  assert.equal(result.reason, "became-available");
});

test("suppresses an unchanged notification inside the reminder window", () => {
  const dates = ["Thursday 1 October 2026"];
  const fingerprint = availabilityFingerprint(dates);
  const result = shouldNotify({
    availableDates: dates,
    previousState: {
      ...EMPTY_STATE,
      status: "available",
      lastNotifiedAt: "2026-07-22T08:00:00.000Z",
      lastNotifiedFingerprint: fingerprint,
    },
    now,
    reminderHours: 6,
  });

  assert.equal(result.notify, false);
  assert.equal(result.reason, "duplicate-suppressed");
});

test("notifies when the available dates change", () => {
  const previousDates = ["Thursday 1 October 2026"];
  const result = shouldNotify({
    availableDates: [
      "Thursday 1 October 2026",
      "Friday 2 October 2026",
    ],
    previousState: {
      ...EMPTY_STATE,
      status: "available",
      lastNotifiedAt: "2026-07-22T09:00:00.000Z",
      lastNotifiedFingerprint: availabilityFingerprint(previousDates),
    },
    now,
    reminderHours: 6,
  });

  assert.equal(result.notify, true);
  assert.equal(result.reason, "availability-changed");
});

test("sends a reminder after the configured interval", () => {
  const dates = ["Thursday 1 October 2026"];
  const fingerprint = availabilityFingerprint(dates);
  const result = shouldNotify({
    availableDates: dates,
    previousState: {
      ...EMPTY_STATE,
      status: "available",
      lastNotifiedAt: "2026-07-22T03:59:59.000Z",
      lastNotifiedFingerprint: fingerprint,
    },
    now,
    reminderHours: 6,
  });

  assert.equal(result.notify, true);
  assert.equal(result.reason, "reminder-due");
});

test("preserves notification metadata when no notification is sent", () => {
  const previousState = {
    ...EMPTY_STATE,
    lastNotifiedAt: "2026-07-22T08:00:00.000Z",
    lastNotifiedFingerprint: "previous-fingerprint",
  };
  const result = nextState({
    availableDates: [],
    previousState,
    checkedAt: now,
    notified: false,
    fingerprint: null,
  });

  assert.equal(result.status, "none");
  assert.equal(result.lastNotifiedAt, previousState.lastNotifiedAt);
  assert.equal(
    result.lastNotifiedFingerprint,
    previousState.lastNotifiedFingerprint,
  );
});
