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
  passportEnglishName:
    /護照英文(?:全名|姓名)|护照英文(?:全名|姓名)|passport\s*(?:english\s*)?(?:full\s*)?name/i,
  email: /(?:有效\s*)?(?:e-?mail|電子郵件|电子邮件|郵箱|邮箱)/i,
  phone: /澳洲手機號|澳洲手机号|australian\s*(?:mobile|phone)|phone\s*number/i,
  visaGrantNumber:
    /澳洲簽證號碼|澳洲签证号码|visa\s*grant\s*(?:no|number)/i,
  plannedTaiwanTravelDate:
    /預計入台旅遊日期|预计入台旅游日期|planned.*taiwan.*(?:travel\s*)?date/i,
};

const CHALLENGE_LABEL =
  /不是機器人|不是机器人|證明您|证明您|not\s+a\s+robot|captcha/i;

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

export async function autofillBookingForm(page, profile) {
  if (!profile) {
    return {
      enabled: false,
      filledFields: [],
      unresolvedFields: [],
      challengeFieldCount: 0,
      stoppedBeforeSubmission: true,
    };
  }

  const descriptors = await formFieldDescriptors(page);
  const result = {
    enabled: true,
    filledFields: [],
    unresolvedFields: [],
    challengeFieldCount: descriptors.filter((field) =>
      CHALLENGE_LABEL.test(`${field.label} ${field.ariaLabel}`),
    ).length,
    stoppedBeforeSubmission: true,
  };

  const fields = page.locator("input, textarea, select");
  for (const [profileField, pattern] of Object.entries(FIELD_RULES)) {
    if (!profile[profileField]) continue;

    const match = bestField(descriptors, pattern);
    if (match.status !== "matched") {
      result.unresolvedFields.push({ field: profileField, reason: match.status });
      continue;
    }

    try {
      const value =
        profileField === "plannedTaiwanTravelDate"
          ? dateForField(profile[profileField], match.field)
          : profile[profileField];
      await fields.nth(match.field.index).fill(value);
      result.filledFields.push(profileField);
    } catch {
      result.unresolvedFields.push({ field: profileField, reason: "fill-failed" });
    }
  }

  return result;
}
