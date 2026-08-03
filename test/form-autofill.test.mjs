import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArithmeticChallenge,
  parseBookingProfile,
  normalizeAustralianMobile,
  solveArithmeticChallenge,
} from "../src/form-autofill.mjs";

test("normalizes an Australian local mobile number to E.164", () => {
  assert.equal(normalizeAustralianMobile("0486 123 456"), "+61486123456");
  assert.equal(normalizeAustralianMobile("61486123456"), "+61486123456");
  assert.equal(normalizeAustralianMobile("+61486123456"), "+61486123456");
});

test("parses and solves a Traditional Chinese subtraction challenge", () => {
  const challenge = parseArithmeticChallenge(
    "為了證明您不是機器人，請回答：115 減 58 等於多少",
  );
  assert.deepEqual(challenge, {
    leftOperand: 115,
    operator: "subtract",
    rightOperand: 58,
  });
  assert.equal(solveArithmeticChallenge(challenge), 57);
});

test("parses and solves a Traditional Chinese multiplication challenge", () => {
  const challenge = parseArithmeticChallenge(
    "為了證明您不是機器人，請回答：29 乘 23 等於多少",
  );
  assert.deepEqual(challenge, {
    leftOperand: 29,
    operator: "multiply",
    rightOperand: 23,
  });
  assert.equal(solveArithmeticChallenge(challenge), 667);
});

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
