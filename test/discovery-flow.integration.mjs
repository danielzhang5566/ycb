import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright";

import {
  captureAvailabilityFlow,
  submitBookingForm,
} from "../src/discovery-capture.mjs";

const artifactRoot = await mkdtemp(join(tmpdir(), "booking-discovery-test-"));
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.route("https://api.youcanbook.me/v1/intents/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        bookingId: "test-booking-id-must-not-be-persisted",
        intentStatus: "BOOKED",
      }),
    });
  });
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <div data-testid="cookie_consent" style="position: fixed; inset: 0; z-index: 100">
          <button data-testid="cookie_consent_accept">Accept</button>
        </div>
        <main id="stage">
          <div role="grid" aria-label="October 2026">
            <button data-testid="day_2026-10-01" aria-label="Thursday 1 October 2026">1</button>
          </div>
        </main>
        <script>
          const stage = document.querySelector("#stage");
          document.querySelector('[data-testid="cookie_consent_accept"]').addEventListener("click", () => {
            document.querySelector('[data-testid="cookie_consent"]').remove();
          });
          document.querySelector('[data-testid="day_2026-10-01"]').addEventListener("click", () => {
            stage.innerHTML = '<button data-testid="time_1330">1:30 pm</button>';
            document.querySelector('[data-testid="time_1330"]').addEventListener("click", () => {
              stage.innerHTML = \`
                <form action="https://booking.example/confirm?token=temporary-secret">
                  <label for="chinese-name">申請人護照中文姓名</label>
                  <input id="chinese-name" data-testid="FNAME" value="private-value" required>
                  <label for="passport-name">申請人護照英文全名</label>
                  <input id="passport-name" data-testid="LNAME" required>
                  <label for="arithmetic">為了證明您不是機器人，請回答：115 減 58 等於多少</label>
                  <select id="arithmetic" data-testid="Q11"><option>Please choose</option><option>57</option></select>
                  <label for="email">有效 Email</label><input id="email" data-testid="EMAIL" type="email">
                  <label for="phone">澳洲手機號 Phone number</label>
                  <div data-testid="Q3_group">
                    <div class="flag-dropdown"><button class="selected-flag" type="button">Country</button></div>
                    <ul><li data-country-code="au">Australia</li></ul>
                    <input id="phone" data-testid="Q3" data-country="us" type="tel">
                  </div>
                  <label for="visa">澳洲簽證號碼 Visa Grant No.</label><input id="visa" data-testid="Q10">
                  <label for="city">為了證明您不是機器人，哪一個是澳洲城市？</label>
                  <select id="city" data-testid="Q14"><option>Please choose</option><option>達爾文</option></select>
                  <div data-testid="Q9"><label for="travel-date">預計入台旅遊日期</label><input id="travel-date" placeholder="DD/MM/YYYY"></div>
                  <label for="relatives">有無同行親屬</label>
                  <select id="relatives" data-testid="Q12"><option>Please choose</option><option value="是">是</option><option value="否">否</option></select>
                  <label for="relative-name">同行親屬人員資訊</label><input id="relative-name" data-testid="Q12-F1">
                  <label for="declaration">資料正確</label><input id="declaration" data-testid="Q8" type="checkbox">
                  <button data-testid="confirm_button" type="button">Confirm booking</button>
                </form>\`;
              document.querySelector('[data-testid="confirm_button"]').addEventListener("click", () => {
                fetch("https://api.youcanbook.me/v1/intents/itt_11111111-1111-1111-1111-111111111111/selections", {
                  method: "PATCH",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ form: [] }),
                });
              });
              document.querySelector('[data-country-code="au"]').addEventListener("click", () => {
                document.querySelector('[data-testid="Q3"]').dataset.country = "au";
              });
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
    autoSubmitBooking: true,
  });

  assert.deepEqual(result.stages, ["calendar", "times", "form"]);
  assert.equal(result.selectedTime, "1:30 pm");
  assert.equal(result.error, null);
  assert.equal(result.cookieConsentDismissed, true);
  assert.deepEqual(result.autofill.filledFields, [
    "passportChineseName",
    "passportEnglishName",
    "emailAddress",
    "phoneNumber",
    "visaGrantNumber",
    "plannedTaiwanTravelDate",
    "hasAccompanyingRelatives",
    "accompanyingRelativeInfo",
    "declarationAccepted",
  ]);
  assert.equal(result.autofill.challengeFieldCount, 2);
  assert.equal(result.autofill.solvedChallengeCount, 2);
  assert.equal(result.autofill.declarationAccepted, true);
  assert.equal(result.autofill.readyToSubmit, true);
  assert.equal(result.submission.attempted, true);
  assert.equal(result.submission.confirmed, true);
  assert.equal(result.submission.status, "confirmed");
  assert.equal(
    JSON.stringify(result.submission).includes("test-booking-id"),
    false,
  );

  await access(join(result.directory, "01-calendar.png"));
  await access(join(result.directory, "02-times.html"));
  await access(join(result.directory, "03-form.structure.json"));

  const formStructure = JSON.parse(
    await readFile(join(result.directory, "03-form.structure.json"), "utf8"),
  );
  const formHtml = await readFile(join(result.directory, "03-form.html"), "utf8");
  assert.equal(formStructure.fields[0].label, "申請人護照中文姓名");
  assert.equal(
    formStructure.buttons.find((button) => button.testId === "confirm_button")
      ?.text,
    "Confirm booking",
  );
  assert.equal(formHtml.includes("temporary-secret"), false);
  assert.equal(formHtml.includes("private-value"), false);
  assert.match(formHtml, /token=(?:%5B)?redacted(?:%5D)?/i);
  assert.equal(await page.locator("#passport-name").inputValue(), "Example Person");
  assert.equal(await page.locator("#phone").inputValue(), "+61400000000");
  assert.equal(await page.locator("#phone").getAttribute("data-country"), "au");
  assert.equal(await page.locator("#travel-date").inputValue(), "23/01/2027");
  assert.equal(await page.locator("#arithmetic").inputValue(), "57");
  assert.equal(await page.locator("#city").inputValue(), "達爾文");
  assert.equal(await page.locator("#relatives").inputValue(), "是");
  assert.equal(
    await page.locator("#relative-name").inputValue(),
    "婚姻 + Example Spouse",
  );
  assert.equal(await page.locator("#declaration").isChecked(), true);
  assert.equal(formHtml.includes("Example Person"), false);
  assert.equal(formHtml.includes("person@example.com"), false);

  const retryPage = await browser.newPage();
  let submissionCount = 0;
  await retryPage.route("https://api.youcanbook.me/v1/intents/**", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "PATCH, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
      return;
    }
    submissionCount += 1;
    await route.fulfill({
      status: submissionCount === 1 ? 409 : 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(
        submissionCount === 1
          ? { code: "INTENT_UNAVAILABLE_TIME_SLOT" }
          : { bookingId: "retry-test-booking-id", intentStatus: "BOOKED" },
      ),
    });
  });
  await retryPage.route("https://booking.test/**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      body: `<!doctype html>
        <main id="stage">
          <div role="grid" aria-label="October 2026">
            <button data-testid="day_2026-10-01" aria-label="Thursday 1 October 2026">1</button>
          </div>
        </main>
        <script>
          const stage = document.querySelector("#stage");
          document.querySelector('[data-testid="day_2026-10-01"]').onclick = () => {
            stage.innerHTML = '<button data-testid="slot_first">1:30 pm</button><button data-testid="slot_second">2:00 pm</button>';
            for (const button of stage.querySelectorAll('[data-testid^="slot_"]')) {
              button.onclick = () => renderForm(button.dataset.testid);
            }
          };
          function renderForm(slot) {
            stage.innerHTML = \`
              <form>
                <label for="cn">申請人護照中文姓名</label><input id="cn" data-testid="FNAME">
                <label for="en">申請人護照英文全名</label><input id="en" data-testid="LNAME">
                <label for="math">為了證明您不是機器人，請回答：29 乘 23 等於多少</label><select id="math" data-testid="Q11"><option>Choose</option><option>667</option></select>
                <label for="mail">有效 Email</label><input id="mail" data-testid="EMAIL">
                <label for="phone2">澳洲手機號</label><input id="phone2" data-testid="Q3" data-country="au">
                <label for="visa2">Visa Grant No.</label><input id="visa2" data-testid="Q10">
                <label for="city2">為了證明您不是機器人，哪一個是澳洲城市?</label><select id="city2" data-testid="Q14"><option>Choose</option><option>Darwin</option></select>
                <div data-testid="Q9"><label for="date2">預計入台旅遊日期</label><input id="date2" placeholder="DD/MM/YYYY"></div>
                <label for="rel2">是否有同行親屬申請人員?</label><select id="rel2" data-testid="Q12"><option>Choose</option><option value="是">是</option><option value="否">否</option></select>
                <div id="dependent"></div>
                <label for="decl2">聲明</label><input id="decl2" data-testid="Q8" type="checkbox">
                <button data-testid="confirm_button" type="button">Confirm Booking</button>
              </form>\`;
            document.querySelector('[data-testid="Q12"]').onchange = (event) => {
              document.querySelector("#dependent").innerHTML = event.target.value === "是"
                ? '<label for="spouse2">同行親屬人員資訊</label><input id="spouse2" data-testid="Q12-F1">'
                : '';
            };
            document.querySelector('[data-testid="confirm_button"]').onclick = () => {
              fetch('https://api.youcanbook.me/v1/intents/itt_' + slot + '/selections', {
                method: 'PATCH', headers: {'content-type': 'application/json'}, body: '{}'
              }).catch(() => {});
            };
          }
        </script>`,
    });
  });
  await retryPage.goto("https://booking.test/");
  const retryResult = await captureAvailabilityFlow({
    page: retryPage,
    artifactRoot,
    checkedAt: new Date("2026-07-23T00:01:00.000Z"),
    bookingUrl: "https://booking.test/",
    calendarResult: {
      availableDates: ["Thursday 1 October 2026"],
      availableDateOptions: [
        { label: "Thursday 1 October 2026", testId: "day_2026-10-01" },
      ],
    },
    networkEvents: [],
    bookingProfile: {
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
    autoSubmitBooking: true,
  });
  const retryManifest = JSON.parse(
    await readFile(join(retryResult.directory, "manifest.json"), "utf8"),
  );
  assert.equal(retryResult.error, null);
  assert.equal(
    retryResult.submission.confirmed,
    true,
    JSON.stringify(retryManifest.attempts),
  );
  assert.equal(retryResult.submission.safeToRetry, false);
  assert.equal(retryResult.submission.status, "confirmed");
  assert.equal(retryResult.autofill.readyToSubmit, true);
  assert.equal(
    await retryPage.locator("#spouse2").inputValue(),
    "婚姻 + Example Spouse",
  );
  assert.equal(submissionCount, 2);
  assert.equal(retryManifest.attempts.length, 2);
  assert.equal(retryManifest.attempts[0].selectedTime, "1:30 pm");
  assert.equal(retryManifest.attempts[0].submission.status, "unavailable");
  assert.equal(retryManifest.attempts[1].selectedTime, "2:00 pm");
  assert.equal(retryManifest.attempts[1].submission.status, "confirmed");
  assert.equal(JSON.stringify(retryManifest).includes("retry-test-booking-id"), false);
  await access(
    join(retryResult.directory, "04-post-submit-attempt-1.diagnostics.json"),
  );
  await access(join(retryResult.directory, "04-post-submit-attempt-1.png"));
  const failedSubmissionHtml = await readFile(
    join(retryResult.directory, "04-post-submit-attempt-1.html"),
    "utf8",
  );
  const failedSubmissionDiagnostics = await readFile(
    join(retryResult.directory, "04-post-submit-attempt-1.diagnostics.json"),
    "utf8",
  );
  assert.equal(
    failedSubmissionDiagnostics.includes("person@example.com"),
    false,
  );
  assert.equal(failedSubmissionDiagnostics.includes("+61400000000"), false);
  assert.equal(failedSubmissionHtml.includes("person@example.com"), false);
  assert.equal(failedSubmissionHtml.includes("Example Person"), false);
  assert.equal(failedSubmissionHtml.includes("+61400000000"), false);
  assert.equal(failedSubmissionHtml.includes("******@example.com"), true);
  assert.equal(failedSubmissionHtml.includes("******* ******"), true);
  assert.equal(failedSubmissionHtml.includes("+61*********"), true);
  const diagnosticData = JSON.parse(failedSubmissionDiagnostics);
  const phoneDiagnostic = diagnosticData.afterClick.fields.find(
    (field) => field.testId === "Q3",
  );
  const emailDiagnostic = diagnosticData.afterClick.fields.find(
    (field) => field.testId === "EMAIL",
  );
  assert.equal(phoneDiagnostic.maskedValue, "+61*********");
  assert.equal(phoneDiagnostic.digitCount, 11);
  assert.equal(phoneDiagnostic.dataCountry, "au");
  assert.equal(phoneDiagnostic.australianMobileFormatValid, true);
  assert.equal(emailDiagnostic.maskedValue, "******@example.com");
  assert.equal(emailDiagnostic.emailFormatValid, true);

  const blockedPage = await browser.newPage();
  await blockedPage.setContent(`
    <form>
      <input data-testid="EMAIL" value="person@example.com" required>
      <textarea name="g-recaptcha-response" style="display:none"></textarea>
      <button data-testid="confirm_button" type="button">Confirm Booking</button>
    </form>
  `);
  const blockedSubmission = await submitBookingForm(
    blockedPage,
    true,
    { readyToSubmit: true },
    100,
  );
  assert.equal(blockedSubmission.attempted, true);
  assert.equal(blockedSubmission.apiRequestObserved, false);
  assert.equal(blockedSubmission.status, "captcha-not-completed");
  assert.equal(blockedSubmission.safeToRetry, true);
  assert.equal(blockedSubmission.retryDifferentSlot, false);
  assert.equal(blockedSubmission.diagnostics.beforeClick.formValid, true);

  console.log("Discovery flow integration test passed.");
} finally {
  await browser.close();
  await rm(artifactRoot, { recursive: true, force: true });
}
