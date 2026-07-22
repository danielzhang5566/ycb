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
              stage.innerHTML = '<form action="https://booking.example/confirm?token=temporary-secret"><label for="name">Name</label><input id="name" name="name" value="private-value" required><button type="submit">Confirm booking</button></form>';
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
  });

  assert.deepEqual(result.stages, ["calendar", "times", "form"]);
  assert.equal(result.selectedTime, "1:30 pm");
  assert.equal(result.error, null);

  await access(join(result.directory, "01-calendar.png"));
  await access(join(result.directory, "02-times.html"));
  await access(join(result.directory, "03-form.structure.json"));

  const formStructure = JSON.parse(
    await readFile(join(result.directory, "03-form.structure.json"), "utf8"),
  );
  const formHtml = await readFile(join(result.directory, "03-form.html"), "utf8");
  assert.equal(formStructure.fields[0].label, "Name");
  assert.equal(formStructure.buttons[0].text, "Confirm booking");
  assert.equal(formHtml.includes("temporary-secret"), false);
  assert.equal(formHtml.includes("private-value"), false);
  assert.match(formHtml, /token=(?:%5B)?redacted(?:%5D)?/i);

  console.log("Discovery flow integration test passed.");
} finally {
  await browser.close();
  await rm(artifactRoot, { recursive: true, force: true });
}
