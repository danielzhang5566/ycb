import assert from "node:assert/strict";
import test from "node:test";

import { parseBookingProfile } from "../src/form-autofill.mjs";

test("parses only supported booking profile fields", () => {
  assert.deepEqual(
    parseBookingProfile(
      JSON.stringify({
        passportEnglishName: "Example Person",
        email: "person@example.com",
        plannedTaiwanTravelDate: "2027-01-23",
      }),
    ),
    {
      passportEnglishName: "Example Person",
      email: "person@example.com",
      plannedTaiwanTravelDate: "2027-01-23",
    },
  );
});

test("rejects unsupported fields without printing their values", () => {
  const privateValue = "do-not-print-this";
  assert.throws(
    () =>
      parseBookingProfile(
        JSON.stringify({ unexpectedPrivateField: privateValue }),
      ),
    (error) => {
      assert.match(error.message, /unsupported fields/);
      assert.equal(error.message.includes(privateValue), false);
      return true;
    },
  );
});

test("requires an ISO travel date", () => {
  assert.throws(
    () =>
      parseBookingProfile(
        JSON.stringify({ plannedTaiwanTravelDate: "23/01/2027" }),
      ),
    /YYYY-MM-DD/,
  );
});

test("preserves supported profile fields that do not have a form mapping yet", () => {
  const profile = parseBookingProfile(
    JSON.stringify({
      chineseName: "Example Name",
      dateOfBirth: "1990-01-02",
      passportNumber: "EXAMPLE123",
      overseasAddress: "Example address",
      entryPermitValidity: "one_year_single_entry",
      maritalStatus: "married",
      spouseName: "Example Spouse",
    }),
  );

  assert.equal(profile.passportNumber, "EXAMPLE123");
  assert.equal(profile.entryPermitValidity, "one_year_single_entry");
  assert.equal(profile.spouseName, "Example Spouse");
});
