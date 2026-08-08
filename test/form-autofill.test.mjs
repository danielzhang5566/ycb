import assert from "node:assert/strict";
import test from "node:test";

import {
  australianNationalMobileNumber,
  formatAccompanyingRelativeInfo,
  parseArithmeticChallenge,
  parseBookingProfile,
  normalizeAustralianMobile,
  solveArithmeticChallenge,
} from "../src/form-autofill.mjs";

test("formats spouse details as relationship plus Chinese name", () => {
  assert.equal(
    formatAccompanyingRelativeInfo("張志豪"),
    "婚姻 + 張志豪",
  );
  assert.equal(
    formatAccompanyingRelativeInfo("婚姻 + 張志豪"),
    "婚姻 + 張志豪",
  );
});

test("normalizes an Australian local mobile number to E.164", () => {
  assert.equal(normalizeAustralianMobile("0486 123 456"), "+61486123456");
  assert.equal(normalizeAustralianMobile("61486123456"), "+61486123456");
  assert.equal(normalizeAustralianMobile("+61486123456"), "+61486123456");
  assert.equal(normalizeAustralianMobile("486123456"), "+61486123456");
  assert.equal(normalizeAustralianMobile("\u200e+61486123456"), "+61486123456");
});

test("converts Australian mobile formats to the national digits expected by the form", () => {
  assert.equal(australianNationalMobileNumber("+61486123456"), "486123456");
  assert.equal(australianNationalMobileNumber("61486123456"), "486123456");
  assert.equal(australianNationalMobileNumber("0486123456"), "486123456");
  assert.equal(australianNationalMobileNumber("486123456"), "486123456");
  assert.equal(
    australianNationalMobileNumber("\u200e+61 486 123 456"),
    "486123456",
  );
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

test("parses readable booking profile keys", () => {
  assert.deepEqual(
    parseBookingProfile(
      JSON.stringify({
        passportChineseName: "Example Chinese Name",
        passportEnglishName: "Example Person",
        emailAddress: "person@example.com",
        phoneNumber: "+61400000000",
        visaGrantNumber: "0000000000000",
        plannedTaiwanTravelDate: "2027-01-23",
        hasAccompanyingRelatives: "是",
        accompanyingRelativeInfo: "婚姻 + Example Spouse",
        declarationAccepted: "yes",
      }),
    ),
    {
      passportChineseName: "Example Chinese Name",
      passportEnglishName: "Example Person",
      emailAddress: "person@example.com",
      phoneNumber: "+61400000000",
      visaGrantNumber: "0000000000000",
      plannedTaiwanTravelDate: "2027-01-23",
      hasAccompanyingRelatives: "是",
      accompanyingRelativeInfo: "婚姻 + Example Spouse",
      declarationAccepted: "yes",
    },
  );
});

test("converts the old profile shape to current readable keys", () => {
  assert.deepEqual(
    parseBookingProfile(
      JSON.stringify({
        chineseName: "Example Chinese Name",
        passportEnglishName: "Example Person",
        email: "person@example.com",
        phone: "0400000000",
        plannedTaiwanTravelDate: "2027-01-23",
        visaGrantNumber: "0000000000000",
        spouseName: "Example Spouse",
        passportNumber: "IGNORED-BECAUSE-NOT-ON-FORM",
      }),
    ),
    {
      passportChineseName: "Example Chinese Name",
      passportEnglishName: "Example Person",
      emailAddress: "person@example.com",
      phoneNumber: "0400000000",
      visaGrantNumber: "0000000000000",
      plannedTaiwanTravelDate: "2027-01-23",
      hasAccompanyingRelatives: "是",
      accompanyingRelativeInfo: "婚姻 + Example Spouse",
      declarationAccepted: "yes",
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

test("requires an ISO planned travel date", () => {
  assert.throws(
    () =>
      parseBookingProfile(
        JSON.stringify({ plannedTaiwanTravelDate: "23/01/2027" }),
      ),
    /YYYY-MM-DD/,
  );
});

test("rejects mixing current and legacy profile keys", () => {
  assert.throws(
    () =>
      parseBookingProfile(
        JSON.stringify({
          passportChineseName: "Example",
          email: "person@example.com",
        }),
      ),
    /cannot mix/,
  );
});
