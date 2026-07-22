const topic = process.env.NTFY_TOPIC?.trim();
const baseUrl = (process.env.NTFY_BASE_URL || "https://ntfy.sh").replace(
  /\/$/,
  "",
);
const bookingUrl =
  process.env.BOOKING_URL ||
  "https://tecomel-traveltotaiwan.youcanbook.me/";

if (!topic) {
  throw new Error(
    "NTFY_TOPIC is not configured. Add it as a GitHub Actions repository secret.",
  );
}

const response = await fetch(baseUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({
    topic,
    title: "预约监控测试通知",
    message: "测试成功：GitHub Actions 已经可以向 ntfy 发送预约监控通知。",
    priority: 3,
    tags: ["white_check_mark", "calendar"],
    click: bookingUrl,
  }),
  signal: AbortSignal.timeout(30_000),
});

if (!response.ok) {
  throw new Error(
    `ntfy returned HTTP ${response.status}: ${await response.text()}`,
  );
}

console.log("Test notification sent successfully.");
