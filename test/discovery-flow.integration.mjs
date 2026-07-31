import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

import { captureAvailabilityFlow } from "../src/discovery-capture.mjs";

const artifactRoot = await mkdtemp(join(tmpdir(), "booking-discovery-test-"));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <main id="stage">
          <div role="grid" aria-label="October 2026">
            <button data-testid="day_2026-10-01" aria-label="Thursday 1 October 2026">1</button>
          </div>
        </main>
        <script>
          const stage = document.querySelector("#stage");
          document.querySelector('[data-testid="day_2026-10-01"]').addEventListener("click", () => {
            stage.innerHTML = '<button data-testid="time_1330">1:30 pm</button>';
            document.querySelector('[data-testid="time_1330"]').addEventListener("click", () => {
              stage.innerHTML = \`
                <form action="https://booking.example/confirm?token=temporary-secret">
                  <label for="passport-name">申請人護照英文全名</label>
                  <input id="passport-name" value="private-value" required>
                  <label for="challenge">為了證明您不是機器人，哪一個是澳洲城市？</label>
                  <select id="challenge"><option>Please choose</option><option>達爾文</option></select>
                  <label for="email">有效 Email</label><input id="email" type="email">
                  <label for="phone">澳洲手機號 Phone number</label><input id="phone" type="tel">
                  <label for="visa">澳洲簽證號碼 Visa Grant No.</label><input id="visa">
                  <label for="travel-date">預計入台旅遊日期</label><input id="travel-date" placeholder="DD/MM/YYYY">
                  <button type="submit">Confirm booking</button>
                </form>\`;
            });
          });
        </script>
      </body>
    </html>
  `);

  const result = await captureAvailabilityFlow({
    page,
    artifactRoot,
    checkedAt: new Date("2026-07-23T00:00:00.000Z"),
    calendarResult: {
      availableDates: ["Thursday 1 October 2026"],
      availableDateOptions: [
        {
          label: "Thursday 1 October 2026",
          testId: "day_2026-10-01",
        },
      ],
    },
    networkEvents: [],
    bookingProfile: {
      passportEnglishName: "Example Person",
      email: "person@example.com",
      phone: "0400000000",
      visaGrantNumber: "0000000000000",
      plannedTaiwanTravelDate: "2027-01-23",
    },
  });

  assert.deepEqual(result.stages, ["calendar", "times", "form"]);
  assert.equal(result.selectedTime, "1:30 pm");
  assert.equal(result.error, null);
  assert.deepEqual(result.autofill.filledFields, [
    "passportEnglishName",
    "email",
    "phone",
    "visaGrantNumber",
    "plannedTaiwanTravelDate",
  ]);
  assert.equal(result.autofill.challengeFieldCount, 1);

  await access(join(result.directory, "01-calendar.png"));
  await access(join(result.directory, "02-times.html"));
  await access(join(result.directory, "03-form.structure.json"));

  const formStructure = JSON.parse(
    await readFile(join(result.directory, "03-form.structure.json"), "utf8"),
  );
  const formHtml = await readFile(join(result.directory, "03-form.html"), "utf8");
  assert.equal(formStructure.fields[0].label, "申請人護照英文全名");
  assert.equal(formStructure.buttons[0].text, "Confirm booking");
  assert.equal(formHtml.includes("temporary-secret"), false);
  assert.equal(formHtml.includes("private-value"), false);
  assert.match(formHtml, /token=(?:%5B)?redacted(?:%5D)?/i);
  assert.equal(await page.locator("#passport-name").inputValue(), "Example Person");
  assert.equal(await page.locator("#travel-date").inputValue(), "23/01/2027");
  assert.equal(await page.locator("#challenge").inputValue(), "Please choose");
  assert.equal(formHtml.includes("Example Person"), false);
  assert.equal(formHtml.includes("person@example.com"), false);

  console.log("Discovery flow integration test passed.");
} finally {
  await browser.close();
  await rm(artifactRoot, { recursive: true, force: true });
}
