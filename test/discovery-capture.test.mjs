import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizedNetworkUrl,
  shouldCaptureDiscovery,
} from "../src/discovery-capture.mjs";
import {
  EMPTY_STATE,
  availabilityFingerprint,
} from "../src/monitor-state.mjs";

test("captures discovery when availability first appears", () => {
  assert.equal(
    shouldCaptureDiscovery(
      ["Thursday 1 October 2026"],
      { ...EMPTY_STATE, status: "none" },
    ),
    true,
  );
});

test("does not capture discovery without available dates when forced", () => {
  assert.equal(
    shouldCaptureDiscovery([], EMPTY_STATE, true),
    false,
  );
});

test("force-captures unchanged availability for automatic submission", () => {
  const dates = ["Thursday 1 October 2026"];
  assert.equal(
    shouldCaptureDiscovery(
      dates,
      {
        ...EMPTY_STATE,
        status: "available",
        fingerprint: availabilityFingerprint(dates),
      },
      true,
    ),
    true,
  );
});

test("does not recapture an unchanged set of available dates", () => {
  const dates = ["Thursday 1 October 2026"];
  assert.equal(
    shouldCaptureDiscovery(dates, {
      ...EMPTY_STATE,
      status: "available",
      fingerprint: availabilityFingerprint(dates),
    }),
    false,
  );
});

test("recaptures when available dates change", () => {
  const previousDates = ["Thursday 1 October 2026"];
  const currentDates = [
    "Thursday 1 October 2026",
    "Friday 2 October 2026",
  ];
  assert.equal(
    shouldCaptureDiscovery(currentDates, {
      ...EMPTY_STATE,
      status: "available",
      fingerprint: availabilityFingerprint(previousDates),
    }),
    true,
  );
});

test("network URL sanitization removes query values", () => {
  assert.deepEqual(
    sanitizedNetworkUrl(
      "https://example.com/api/slots?date=2026-10-01&token=secret&date=other",
    ),
    {
      origin: "https://example.com",
      pathname: "/api/slots",
      queryKeys: ["date", "token"],
    },
  );
});

test("network URL sanitization redacts long path credentials", () => {
  const credential = "a".repeat(64);
  const result = sanitizedNetworkUrl(
    `https://example.com/session/${credential}/availability`,
  );

  assert.equal(result.pathname, "/session/[redacted-segment]/availability");
  assert.equal(JSON.stringify(result).includes(credential), false);
});

test("network URL sanitization redacts YouCanBookMe intent identifiers", () => {
  const intentId = "itt_933827f3-d7f7-48dd-9ec4-d19a3b4fd4fc";
  const result = sanitizedNetworkUrl(
    `https://api.youcanbook.me/v1/intents/${intentId}/selections`,
  );

  assert.equal(
    result.pathname,
    "/v1/intents/[redacted-segment]/selections",
  );
  assert.equal(JSON.stringify(result).includes(intentId), false);
});
