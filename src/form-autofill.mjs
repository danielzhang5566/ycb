const PROFILE_FIELDS = [
  "passportChineseName",
  "passportEnglishName",
  "emailAddress",
  "phoneNumber",
  "visaGrantNumber",
  "plannedTaiwanTravelDate",
  "hasAccompanyingRelatives",
  "accompanyingRelativeInfo",
  "declarationAccepted",
];

const PROFILE_TO_FORM_FIELD = Object.freeze({
  passportChineseName: "FNAME",
  passportEnglishName: "LNAME",
  emailAddress: "EMAIL",
  phoneNumber: "Q3",
  visaGrantNumber: "Q10",
  plannedTaiwanTravelDate: "Q9",
  hasAccompanyingRelatives: "Q12",
  accompanyingRelativeInfo: "Q12-F1",
  declarationAccepted: "Q8",
});

const LEGACY_PROFILE_FIELDS = [
  "chineseName",
  "passportEnglishName",
  "email",
  "phone",
  "plannedTaiwanTravelDate",
  "dateOfBirth",
  "gender",
  "mainlandChinaIdNumber",
  "passportNumber",
  "passportIssueDate",
  "passportExpiryDate",
  "overseasAddress",
  "visaGrantNumber",
  "australianVisaExpiryDate",
  "entryPermitValidity",
  "maritalStatus",
  "spouseName",
];

const REQUIRED_PROFILE_FIELDS = [
  "passportChineseName",
  "passportEnglishName",
  "emailAddress",
  "phoneNumber",
  "visaGrantNumber",
  "plannedTaiwanTravelDate",
  "hasAccompanyingRelatives",
  "declarationAccepted",
];

const INPUT_PROFILE_FIELDS = [
  "passportChineseName",
  "passportEnglishName",
  "emailAddress",
  "phoneNumber",
  "visaGrantNumber",
  "plannedTaiwanTravelDate",
];

const AUSTRALIAN_CITY_NAMES = new Set(
  [
    "adelaide",
    "brisbane",
    "canberra",
    "darwin",
    "hobart",
    "melbourne",
    "perth",
    "sydney",
    "阿德萊德",
    "阿德莱德",
    "布里斯本",
    "坎培拉",
    "堪培拉",
    "達爾文",
    "达尔文",
    "荷巴特",
    "霍巴特",
    "墨爾本",
    "墨尔本",
    "伯斯",
    "珀斯",
    "悉尼",
    "雪梨",
  ].map((value) => value.toLowerCase()),
);

const CHALLENGE_LABEL =
  /不是機器人|不是机器人|證明您|证明您|not\s+a\s+robot|captcha/i;

const ARITHMETIC_OPERATORS = {
  "+": "add",
  加: "add",
  "-": "subtract",
  "−": "subtract",
  減: "subtract",
  减: "subtract",
  "*": "multiply",
  "×": "multiply",
  x: "multiply",
  X: "multiply",
  乘: "multiply",
  "/": "divide",
  "÷": "divide",
  除: "divide",
};

export function parseArithmeticChallenge(text) {
  const operatorTokens = Object.keys(ARITHMETIC_OPERATORS)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const match = String(text).match(
    new RegExp(`(-?\\d+)\\s*(${operatorTokens})\\s*(-?\\d+)`),
  );
  if (!match) return null;

  return Object.freeze({
    leftOperand: Number(match[1]),
    operator: ARITHMETIC_OPERATORS[match[2]],
    rightOperand: Number(match[3]),
  });
}

export function solveArithmeticChallenge(challenge) {
  if (!challenge) return null;
  const { leftOperand, operator, rightOperand } = challenge;
  if (operator === "add") return leftOperand + rightOperand;
  if (operator === "subtract") return leftOperand - rightOperand;
  if (operator === "multiply") return leftOperand * rightOperand;
  if (operator === "divide" && rightOperand !== 0) {
    return leftOperand / rightOperand;
  }
  return null;
}

export function normalizeAustralianMobile(value) {
  const compact = String(value || "").replace(/[\s()\-\p{Cf}]/gu, "");
  if (/^04\d{8}$/.test(compact)) return `+61${compact.slice(1)}`;
  if (/^614\d{8}$/.test(compact)) return `+${compact}`;
  if (/^4\d{8}$/.test(compact)) return `+61${compact}`;
  return compact;
}

export function australianNationalMobileNumber(value) {
  const compact = String(value || "").replace(/[\s()\-\p{Cf}]/gu, "");
  if (/^\+614\d{8}$/.test(compact)) return compact.slice(3);
  if (/^614\d{8}$/.test(compact)) return compact.slice(2);
  if (/^04\d{8}$/.test(compact)) return compact.slice(1);
  return compact;
}

export function formatAccompanyingRelativeInfo(spouseName) {
  const value = String(spouseName || "").trim();
  if (!value) return "";
  if (/^婚姻\s*\+/u.test(value)) return value;
  return `婚姻 + ${value}`;
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

export function parseBookingProfile(rawProfile) {
  if (!rawProfile?.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(rawProfile);
  } catch {
    throw new Error("BOOKING_PROFILE_JSON must contain valid JSON");
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("BOOKING_PROFILE_JSON must be a JSON object");
  }

  const supportedFields = new Set([
    ...PROFILE_FIELDS,
    ...LEGACY_PROFILE_FIELDS,
  ]);
  const unknownFields = Object.keys(parsed).filter(
    (field) => !supportedFields.has(field),
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `BOOKING_PROFILE_JSON contains unsupported fields: ${unknownFields.join(", ")}`,
    );
  }

  const hasReadableFields = PROFILE_FIELDS.some(
    (field) => !LEGACY_PROFILE_FIELDS.includes(field) && field in parsed,
  );
  const hasLegacyFields = LEGACY_PROFILE_FIELDS.some(
    (field) => !PROFILE_FIELDS.includes(field) && field in parsed,
  );
  if (hasReadableFields && hasLegacyFields) {
    throw new Error(
      "BOOKING_PROFILE_JSON cannot mix current profile keys with legacy profile keys",
    );
  }

  const source = hasLegacyFields
    ? {
        passportChineseName: parsed.chineseName,
        passportEnglishName: parsed.passportEnglishName,
        emailAddress: parsed.email,
        phoneNumber: parsed.phone,
        visaGrantNumber: parsed.visaGrantNumber,
        plannedTaiwanTravelDate: parsed.plannedTaiwanTravelDate,
        hasAccompanyingRelatives: parsed.spouseName ? "是" : "否",
        accompanyingRelativeInfo: parsed.spouseName
          ? formatAccompanyingRelativeInfo(parsed.spouseName)
          : undefined,
        declarationAccepted: "yes",
      }
    : parsed;

  const profile = {};
  for (const field of PROFILE_FIELDS) {
    const value = source[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      throw new Error(`BOOKING_PROFILE_JSON field ${field} must be a string`);
    }
    profile[field] = value.trim();
  }

  if (
    profile.plannedTaiwanTravelDate &&
    !validIsoDate(profile.plannedTaiwanTravelDate)
  ) {
    throw new Error(
      "BOOKING_PROFILE_JSON field plannedTaiwanTravelDate must use YYYY-MM-DD",
    );
  }
  if (
    profile.hasAccompanyingRelatives &&
    !/^(?:是|否|yes|no)$/i.test(profile.hasAccompanyingRelatives)
  ) {
    throw new Error(
      "BOOKING_PROFILE_JSON field hasAccompanyingRelatives must be 是 or 否",
    );
  }
  if (
    profile.declarationAccepted &&
    !/^(?:yes|true|是)$/i.test(profile.declarationAccepted)
  ) {
    throw new Error(
      "BOOKING_PROFILE_JSON field declarationAccepted must confirm the declaration",
    );
  }

  return Object.freeze(profile);
}

function dateForField(isoDate, descriptor) {
  if (descriptor.type === "date") return isoDate;
  if (/dd\s*[/.-]\s*mm\s*[/.-]\s*yyyy/i.test(descriptor.placeholder)) {
    const [year, month, day] = isoDate.split("-");
    return `${day}/${month}/${year}`;
  }
  return isoDate;
}

async function formFieldDescriptors(page) {
  return page.locator("input, textarea, select").evaluateAll((fields) => {
    const normalizedText = (value) =>
      (value || "").replace(/\s+/g, " ").trim().slice(0, 400);

    const visible = (field) => {
      const style = getComputedStyle(field);
      const rect = field.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };

    const labelFor = (field) => {
      const labels = [];
      if (field.id) {
        const explicit = document.querySelector(
          `label[for="${CSS.escape(field.id)}"]`,
        );
        if (explicit) labels.push(explicit.textContent);
      }
      const wrappingLabel = field.closest("label");
      if (wrappingLabel) labels.push(wrappingLabel.textContent);
      if (field.labels) {
        labels.push(...[...field.labels].map((label) => label.textContent));
      }
      return normalizedText(labels.filter(Boolean).join(" "));
    };

    return fields.map((field, index) => ({
      index,
      tag: field.tagName.toLowerCase(),
      type: (field.getAttribute("type") || "").toLowerCase(),
      name: normalizedText(field.getAttribute("name")),
      id: normalizedText(field.id),
      label: labelFor(field),
      ariaLabel: normalizedText(field.getAttribute("aria-label")),
      placeholder: normalizedText(field.getAttribute("placeholder")),
      testId: normalizedText(field.getAttribute("data-testid")),
      disabled: field.disabled,
      visible: visible(field),
    }));
  });
}

function normalizedOptionText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function selectMatchingOption(select, predicate) {
  const options = await select.locator("option").evaluateAll((elements) =>
    elements.map((option) => ({
      label: (option.textContent || "").replace(/\s+/g, " ").trim(),
      value: option.value,
    })),
  );
  const match = options.find((option) => predicate(option.label, option.value));
  if (!match) return false;
  await select.selectOption(match.value);
  return true;
}

async function fillExactField(page, testId, value) {
  const testIdLocator = page.getByTestId(testId);
  if ((await testIdLocator.count()) !== 1) return false;
  const locator = await testIdLocator
    .evaluate((element) => element.matches("input, textarea"))
    .then((isInput) =>
      isInput
        ? testIdLocator
        : testIdLocator.locator('input:not([type="hidden"]), textarea'),
    );
  if ((await locator.count()) !== 1 || !(await locator.isVisible())) return false;
  let formValue = value;
  if (testId === "Q9") {
    formValue = dateForField(value, {
      type: (await locator.getAttribute("type")) || "",
      placeholder: (await locator.getAttribute("placeholder")) || "",
    });
  }
  await locator.fill(formValue);
  if (["Q3", "Q9"].includes(testId)) await locator.blur();
  return true;
}

async function australianPhoneFieldIsValid(page) {
  const phone = page.getByTestId("Q3");
  if ((await phone.count()) !== 1) return false;
  await page.waitForTimeout(100);
  const state = await phone.evaluate((element) => {
    const compact = element.value.replace(/[\s()\-\p{Cf}]/gu, "");
    const group = element.closest('[data-testid="Q3_group"]');
    return {
      country: element.getAttribute("data-country"),
      nationalFormatValid: /^4\d{8}$/.test(compact),
      markedInvalid:
        element.classList.contains("invalid-number") ||
        /please enter a valid telephone number/i.test(group?.textContent || ""),
    };
  });
  return (
    state.country === "au" &&
    state.nationalFormatValid &&
    !state.markedInvalid
  );
}

export async function ensureAustralianPhoneCountry(page) {
  const phone = page.getByTestId("Q3");
  if ((await phone.count()) !== 1 || !(await phone.isVisible())) return false;

  if ((await phone.getAttribute("data-country")) === "au") return true;

  const group = page.getByTestId("Q3_group");
  const scope = (await group.count()) === 1 ? group : page.locator("body");
  const selector = scope.locator(".selected-flag");
  if ((await selector.count()) !== 1 || !(await selector.isVisible())) {
    return false;
  }

  await selector.click();
  const australia = scope.locator('[data-country-code="au"]');
  if ((await australia.count()) !== 1 || !(await australia.isVisible())) {
    return false;
  }
  await australia.click();
  await page
    .waitForFunction(
      () =>
        document.querySelector('[data-testid="Q3"]')?.dataset.country ===
        "au",
      undefined,
      { timeout: 2_000 },
    )
    .catch(() => {});

  return (await phone.getAttribute("data-country")) === "au";
}

function pushUnresolved(result, field, reason) {
  if (!result.unresolvedFields.some((item) => item.field === field)) {
    result.unresolvedFields.push({ field, reason });
  }
}

export async function autofillBookingForm(page, profile) {
  if (!profile) {
    return {
      enabled: false,
      filledFields: [],
      unresolvedFields: [],
      challengeFieldCount: 0,
      solvedChallengeCount: 0,
      declarationAccepted: false,
      readyToSubmit: false,
      stoppedBeforeSubmission: true,
    };
  }

  const descriptors = await formFieldDescriptors(page);
  const result = {
    enabled: true,
    filledFields: [],
    unresolvedFields: [],
    challengeFieldCount: descriptors.filter(
      (field) =>
        field.visible &&
        CHALLENGE_LABEL.test(`${field.label} ${field.ariaLabel}`),
    ).length,
    solvedChallengeCount: 0,
    declarationAccepted: false,
    readyToSubmit: false,
    stoppedBeforeSubmission: true,
  };

  const filled = new Set();

  for (const profileField of INPUT_PROFILE_FIELDS) {
    if (!profile[profileField]) continue;
    const testId = PROFILE_TO_FORM_FIELD[profileField];
    try {
      if (profileField === "phoneNumber") {
        if (!(await ensureAustralianPhoneCountry(page))) {
          pushUnresolved(result, "phoneCountry", "australia-not-selected");
          continue;
        }
      }
      const value =
        profileField === "phoneNumber"
          ? australianNationalMobileNumber(profile[profileField])
          : profile[profileField];
      if (await fillExactField(page, testId, value)) {
        if (
          profileField === "phoneNumber" &&
          !(await australianPhoneFieldIsValid(page))
        ) {
          pushUnresolved(result, profileField, "invalid-australian-mobile");
          continue;
        }
        filled.add(profileField);
        result.filledFields.push(profileField);
      }
    } catch {
      pushUnresolved(result, profileField, "fill-failed");
    }
  }

  const arithmeticSelect = page.getByTestId("Q11");
  if ((await arithmeticSelect.count()) === 1) {
    const descriptor = descriptors.find((field) => field.testId === "Q11");
    const challenge = parseArithmeticChallenge(descriptor?.label);
    const answer = solveArithmeticChallenge(challenge);
    const selected =
      answer !== null &&
      Number.isFinite(answer) &&
      (await selectMatchingOption(
        arithmeticSelect,
        (label, value) =>
          normalizedOptionText(label) === String(answer) ||
          normalizedOptionText(value) === String(answer),
      ));
    if (selected) result.solvedChallengeCount += 1;
    else pushUnresolved(result, "arithmeticChallenge", "not-solved");
  } else {
    pushUnresolved(result, "arithmeticChallenge", "field-missing");
  }

  const citySelect = page.getByTestId("Q14");
  if ((await citySelect.count()) === 1) {
    const selected = await selectMatchingOption(citySelect, (label) =>
      AUSTRALIAN_CITY_NAMES.has(normalizedOptionText(label).toLowerCase()),
    );
    if (selected) result.solvedChallengeCount += 1;
    else pushUnresolved(result, "australianCityChallenge", "not-solved");
  } else {
    pushUnresolved(result, "australianCityChallenge", "field-missing");
  }

  const relativesSelect = page.getByTestId("Q12");
  if ((await relativesSelect.count()) === 1) {
    const hasAccompanyingRelative = /^(?:是|yes)$/i.test(
      profile.hasAccompanyingRelatives || "",
    );
    const selected = await selectMatchingOption(
      relativesSelect,
      (label, value) => {
        const option = `${label} ${value}`.toLowerCase();
        return hasAccompanyingRelative
          ? /(?:^|\s)(?:是|yes)(?:\s|$)/i.test(option)
          : /(?:^|\s)(?:否|no)(?:\s|$)/i.test(option);
      },
    );
    if (selected) {
      filled.add("hasAccompanyingRelatives");
      result.filledFields.push("hasAccompanyingRelatives");
    } else {
      pushUnresolved(result, "hasAccompanyingRelatives", "option-missing");
    }
    if (hasAccompanyingRelative && selected) {
      const relativeDetails = page.getByTestId("Q12-F1");
      const appeared = await relativeDetails
        .waitFor({ state: "visible", timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (appeared && (await relativeDetails.count()) === 1) {
        try {
          await relativeDetails.fill(profile.accompanyingRelativeInfo || "");
          filled.add("accompanyingRelativeInfo");
          result.filledFields.push("accompanyingRelativeInfo");
        } catch {
          pushUnresolved(result, "accompanyingRelativeInfo", "fill-failed");
        }
      } else {
        pushUnresolved(result, "accompanyingRelativeInfo", "field-missing");
      }
    }
  } else {
    pushUnresolved(result, "hasAccompanyingRelatives", "field-missing");
  }

  if (
    /^(?:是|yes)$/i.test(profile.hasAccompanyingRelatives || "") &&
    !profile.accompanyingRelativeInfo
  ) {
    pushUnresolved(result, "accompanyingRelativeInfo", "profile-missing");
  }

  const declaration = page.getByTestId("Q8");
  if ((await declaration.count()) === 1) {
    try {
      await declaration.check();
      result.declarationAccepted = await declaration.isChecked();
      if (result.declarationAccepted) {
        filled.add("declarationAccepted");
        result.filledFields.push("declarationAccepted");
      }
    } catch {
      pushUnresolved(result, "declaration", "check-failed");
    }
  } else {
    pushUnresolved(result, "declarationAccepted", "field-missing");
  }

  for (const profileField of REQUIRED_PROFILE_FIELDS) {
    if (!profile[profileField]) {
      pushUnresolved(result, profileField, "profile-missing");
    } else if (!filled.has(profileField)) {
      pushUnresolved(result, profileField, "field-missing");
    }
  }

  if (result.challengeFieldCount !== result.solvedChallengeCount) {
    pushUnresolved(result, "verificationChallenges", "incomplete");
  }

  result.readyToSubmit =
    result.unresolvedFields.length === 0 && result.declarationAccepted;

  return result;
}
