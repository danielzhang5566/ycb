const PROFILE_FIELDS = [
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

const DATE_FIELDS = [
  "plannedTaiwanTravelDate",
  "dateOfBirth",
  "passportIssueDate",
  "passportExpiryDate",
  "australianVisaExpiryDate",
];

const FIELD_RULES = {
  chineseName:
    /護照中文姓名|护照中文姓名|chinese\s*(?:full\s*)?name/i,
  passportEnglishName:
    /護照英文(?:全名|姓名)|护照英文(?:全名|姓名)|passport\s*(?:english\s*)?(?:full\s*)?name/i,
  email: /(?:有效\s*)?(?:e-?mail|電子郵件|电子邮件|郵箱|邮箱)/i,
  phone: /澳洲手機號|澳洲手机号|australian\s*(?:mobile|phone)|phone\s*number/i,
  visaGrantNumber:
    /澳洲簽證號碼|澳洲签证号码|visa\s*grant\s*(?:no|number)/i,
  plannedTaiwanTravelDate:
    /預計入台旅遊日期|预计入台旅游日期|planned.*taiwan.*(?:travel\s*)?date/i,
};

const EXACT_INPUT_FIELDS = {
  chineseName: "FNAME",
  passportEnglishName: "LNAME",
  email: "EMAIL",
  phone: "Q3",
  visaGrantNumber: "Q10",
};

const REQUIRED_PROFILE_FIELDS = [
  "chineseName",
  "passportEnglishName",
  "email",
  "phone",
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
  const compact = String(value || "").replace(/[\s()-]/g, "");
  if (/^04\d{8}$/.test(compact)) return `+61${compact.slice(1)}`;
  if (/^614\d{8}$/.test(compact)) return `+${compact}`;
  return compact;
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

  const unknownFields = Object.keys(parsed).filter(
    (field) => !PROFILE_FIELDS.includes(field),
  );
  if (unknownFields.length > 0) {
    throw new Error(
      `BOOKING_PROFILE_JSON contains unsupported fields: ${unknownFields.join(", ")}`,
    );
  }

  const profile = {};
  for (const field of PROFILE_FIELDS) {
    const value = parsed[field];
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      throw new Error(`BOOKING_PROFILE_JSON field ${field} must be a string`);
    }
    profile[field] = value.trim();
  }

  for (const field of DATE_FIELDS) {
    if (profile[field] && !validIsoDate(profile[field])) {
      throw new Error(
        `BOOKING_PROFILE_JSON field ${field} must use YYYY-MM-DD`,
      );
    }
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

function fieldScore(descriptor, pattern) {
  if (pattern.test(descriptor.label)) return 100;
  if (pattern.test(descriptor.ariaLabel)) return 90;
  if (pattern.test(descriptor.placeholder)) return 80;
  if (pattern.test(descriptor.name)) return 70;
  if (pattern.test(descriptor.id)) return 60;
  return 0;
}

function bestField(descriptors, pattern) {
  const candidates = descriptors
    .filter(
      (field) =>
        field.visible &&
        !field.disabled &&
        !["hidden", "submit", "button", "checkbox", "radio"].includes(
          field.type,
        ) &&
        field.tag !== "select",
    )
    .map((field) => ({ field, score: fieldScore(field, pattern) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) return { status: "missing" };
  if (
    candidates.length > 1 &&
    candidates[0].score === candidates[1].score
  ) {
    return { status: "ambiguous" };
  }
  return { status: "matched", field: candidates[0].field };
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
  const locator = page.getByTestId(testId);
  if ((await locator.count()) !== 1 || !(await locator.isVisible())) return false;
  await locator.fill(value);
  return true;
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

  for (const [profileField, testId] of Object.entries(EXACT_INPUT_FIELDS)) {
    if (!profile[profileField]) continue;
    try {
      const value =
        profileField === "phone"
          ? normalizeAustralianMobile(profile[profileField])
          : profile[profileField];
      if (await fillExactField(page, testId, value)) {
        filled.add(profileField);
        result.filledFields.push(profileField);
      }
    } catch {
      pushUnresolved(result, profileField, "fill-failed");
    }
  }

  const fields = page.locator("input, textarea, select");
  for (const [profileField, pattern] of Object.entries(FIELD_RULES)) {
    if (!profile[profileField] || filled.has(profileField)) continue;

    const match = bestField(descriptors, pattern);
    if (match.status !== "matched") {
      pushUnresolved(result, profileField, match.status);
      continue;
    }

    try {
      const value =
        profileField === "plannedTaiwanTravelDate"
          ? dateForField(profile[profileField], match.field)
          : profile[profileField];
      await fields.nth(match.field.index).fill(value);
      filled.add(profileField);
      result.filledFields.push(profileField);
    } catch {
      pushUnresolved(result, profileField, "fill-failed");
    }
  }

  for (const profileField of REQUIRED_PROFILE_FIELDS) {
    if (!profile[profileField]) {
      pushUnresolved(result, profileField, "profile-missing");
    } else if (!filled.has(profileField)) {
      pushUnresolved(result, profileField, "field-missing");
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
    const hasAccompanyingRelative = Boolean(profile.spouseName);
    const selected = await selectMatchingOption(
      relativesSelect,
      (label, value) => {
        const option = `${label} ${value}`.toLowerCase();
        return hasAccompanyingRelative
          ? /(?:^|\s)(?:是|yes)(?:\s|$)/i.test(option)
          : /(?:^|\s)(?:否|no)(?:\s|$)/i.test(option);
      },
    );
    if (selected) result.filledFields.push("accompanyingRelatives");
    else pushUnresolved(result, "accompanyingRelatives", "option-missing");
    if (hasAccompanyingRelative && selected) {
      const relativeDetails = page.getByTestId("Q12-F1");
      const appeared = await relativeDetails
        .waitFor({ state: "visible", timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (appeared && (await relativeDetails.count()) === 1) {
        try {
          await relativeDetails.fill(profile.spouseName);
          filled.add("spouseName");
          result.filledFields.push("spouseName");
        } catch {
          pushUnresolved(result, "spouseName", "fill-failed");
        }
      } else {
        pushUnresolved(result, "spouseName", "field-missing");
      }
    }
  } else {
    pushUnresolved(result, "accompanyingRelatives", "field-missing");
  }

  const declaration = page.getByTestId("Q8");
  if ((await declaration.count()) === 1) {
    try {
      await declaration.check();
      result.declarationAccepted = await declaration.isChecked();
    } catch {
      pushUnresolved(result, "declaration", "check-failed");
    }
  } else {
    pushUnresolved(result, "declaration", "field-missing");
  }

  if (result.challengeFieldCount !== result.solvedChallengeCount) {
    pushUnresolved(result, "verificationChallenges", "incomplete");
  }

  result.readyToSubmit =
    result.unresolvedFields.length === 0 && result.declarationAccepted;

  return result;
}
