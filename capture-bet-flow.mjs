#!/usr/bin/env node
/**
 * Bet Flow Capture Script — Comprehensive Edition
 *
 * Captures EVERYTHING during a sportsbook bet placement:
 *   - All HTTP requests + responses (headers, cookies, bodies)
 *   - All WebSocket frames (text + binary as hex)
 *   - Browser cookies, localStorage, sessionStorage
 *   - Console messages
 *   - Periodic screenshots
 *   - Failed/aborted requests
 *
 * Auto-saves every 30 seconds in case of crash.
 * Final save on Ctrl+C includes a full browser state dump.
 *
 * Usage:
 *   node capture-bet-flow.mjs draftkings
 *   node capture-bet-flow.mjs fanduel
 *   node capture-bet-flow.mjs betmgm
 *   node capture-bet-flow.mjs caesars
 *   node capture-bet-flow.mjs bet365
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

// ── Config ──────────────────────────────────────────────────────────────────
const BOOK_URLS = {
  draftkings: "https://sportsbook.draftkings.com",
  fanduel: "https://sportsbook.fanduel.com",
  betmgm: "https://sports.betmgm.com",
  caesars: "https://sportsbook.caesars.com",
  bet365: "https://www.bet365.com",
};

// Only skip things that are obviously NOT API calls
const SKIP_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2", ".ttf", ".eot", ".map"];
const SKIP_DOMAINS = ["google-analytics.com", "doubleclick.net", "facebook.net", "facebook.com", "fullstory.com", "nr-data.net", "newrelic.com", "demdex.net", "cookielaw.org", "onetrust.com", "bing.com", "trafficguard.ai"];

// Keywords that indicate bet-related API calls — highlighted in console
const BET_KEYWORDS = ["/bet", "/wager", "/slip", "/place", "/confirm", "/stake", "/parlay", "/cashout", "/cashier", "/deposit", "/withdraw", "/balance", "/account", "/auth", "/login", "/session", "/token", "/odds", "/price", "/selection", "/market", "/event"];

const AUTO_SAVE_INTERVAL_MS = 30_000;
const SCREENSHOT_INTERVAL_MS = 15_000;
const MAX_BODY_SIZE = 500_000; // 500KB per response body

// ── Setup ───────────────────────────────────────────────────────────────────
const bookArg = process.argv[2]?.toLowerCase();
if (!bookArg || !BOOK_URLS[bookArg]) {
  console.log("\n  Bet Flow Capture — Comprehensive Edition\n");
  console.log("  Usage: node capture-bet-flow.mjs <book>\n");
  console.log("  Books:");
  for (const [name, url] of Object.entries(BOOK_URLS)) {
    console.log(`    ${name.padEnd(14)} ${url}`);
  }
  console.log("");
  process.exit(1);
}

const startUrl = BOOK_URLS[bookArg];
const sessionId = Date.now();
const outDir = join(process.cwd(), `capture-${bookArg}-${sessionId}`);
mkdirSync(outDir, { recursive: true });

const data = {
  meta: {
    book: bookArg,
    startUrl,
    startTime: new Date().toISOString(),
    endTime: null,
    userAgent: null,
    totalRequests: 0,
    totalResponses: 0,
    totalWsFrames: 0,
    totalScreenshots: 0,
    totalConsoleMessages: 0,
  },
  requests: [],
  responses: [],
  wsFrames: [],
  consoleMessages: [],
  cookies: [],
  localStorage: {},
  sessionStorage: {},
  screenshots: [],
};

let seq = 0;
let saving = false;

function shouldSkip(url) {
  for (const ext of SKIP_EXTENSIONS) {
    if (url.includes(ext)) return true;
  }
  for (const domain of SKIP_DOMAINS) {
    if (url.includes(domain)) return true;
  }
  return false;
}

function isBetRelated(url) {
  const lower = url.toLowerCase();
  return BET_KEYWORDS.some((kw) => lower.includes(kw));
}

function truncateBody(body, maxLen = MAX_BODY_SIZE) {
  if (!body) return body;
  if (body.length <= maxLen) return body;
  return body.slice(0, maxLen) + `\n[TRUNCATED — ${body.length} total bytes]`;
}

// ── Banner ──────────────────────────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════════════════╗
║         BET FLOW CAPTURE — ${bookArg.toUpperCase().padEnd(16)}          ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  1. Log into your account                            ║
║  2. Browse to a game — click around the site a bit   ║
║  3. Add a selection to your bet slip                 ║
║  4. Enter the minimum stake                          ║
║  5. Place the bet                                    ║
║  6. WAIT for the confirmation screen                 ║
║  7. Check your bet history page too                  ║
║  8. Press Ctrl+C here when completely done            ║
║                                                      ║
║  Auto-saves every 30s. Screenshots every 15s.        ║
║  Output: ${outDir.slice(-50).padEnd(43)}║
║                                                      ║
╚══════════════════════════════════════════════════════╝
`);

// ── Launch Browser ──────────────────────────────────────────────────────────
const browser = await chromium.launch({
  headless: false,
  args: [
    "--start-maximized",
    "--disable-blink-features=AutomationControlled",
  ],
});

const context = await browser.newContext({
  viewport: null,
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  locale: "en-US",
  timezoneId: "America/New_York",
});

data.meta.userAgent = "Chrome/131 Windows";

// ── Instrument Page ─────────────────────────────────────────────────────────
function instrumentPage(page, label = "main") {

  // ── Requests ──────────────────────────────────────────────────────────
  page.on("request", (req) => {
    const url = req.url();
    if (shouldSkip(url)) return;

    seq++;
    data.meta.totalRequests++;

    const entry = {
      seq,
      page: label,
      time: new Date().toISOString(),
      method: req.method(),
      url,
      headers: req.headers(),
      postData: req.postData() || null,
      resourceType: req.resourceType(),
    };
    data.requests.push(entry);

    // Console output for interesting calls
    if (req.method() !== "GET" || isBetRelated(url)) {
      const marker = isBetRelated(url) ? "★" : "›";
      console.log(`  ${marker} ${req.method()} ${url.slice(0, 130)}`);
      if (entry.postData) {
        const preview = entry.postData.slice(0, 200);
        console.log(`    body: ${preview}${entry.postData.length > 200 ? "..." : ""}`);
      }
    }
  });

  // ── Responses ─────────────────────────────────────────────────────────
  page.on("response", async (res) => {
    const url = res.url();
    if (shouldSkip(url)) return;

    data.meta.totalResponses++;

    let body = null;
    let bodyType = "none";
    try {
      const ct = res.headers()["content-type"] || "";
      if (ct.includes("json") || ct.includes("text") || ct.includes("xml") || ct.includes("html") || ct.includes("javascript")) {
        body = truncateBody(await res.text());
        bodyType = "text";
      } else if (ct.includes("octet-stream") || ct.includes("protobuf") || ct.includes("msgpack") || ct.includes("grpc")) {
        // Binary API responses — base64 encode
        const buf = await res.body().catch(() => null);
        if (buf && buf.length < MAX_BODY_SIZE) {
          body = buf.toString("base64");
          bodyType = "base64";
        }
      }
    } catch {
      // Body not available (e.g., redirects)
    }

    data.responses.push({
      seq,
      page: label,
      time: new Date().toISOString(),
      url,
      status: res.status(),
      statusText: res.statusText(),
      headers: res.headers(),
      body,
      bodyType,
    });

    if (isBetRelated(url)) {
      console.log(`  ◄ ${res.status()} ${url.slice(0, 130)}`);
    }
  });

  // ── Request failures ──────────────────────────────────────────────────
  page.on("requestfailed", (req) => {
    const url = req.url();
    if (shouldSkip(url)) return;

    data.requests.push({
      seq: ++seq,
      page: label,
      time: new Date().toISOString(),
      method: req.method(),
      url,
      failed: true,
      failureText: req.failure()?.errorText || "unknown",
    });
  });

  // ── WebSockets ────────────────────────────────────────────────────────
  page.on("websocket", (ws) => {
    const wsUrl = ws.url();

    data.wsFrames.push({
      type: "open",
      time: new Date().toISOString(),
      url: wsUrl,
      page: label,
    });
    console.log(`  ⚡ WS opened: ${wsUrl.slice(0, 120)}`);

    ws.on("framereceived", (frame) => {
      data.meta.totalWsFrames++;
      const entry = {
        type: "recv",
        time: new Date().toISOString(),
        url: wsUrl.slice(0, 150),
      };

      if (typeof frame.payload === "string") {
        entry.encoding = "text";
        entry.payload = frame.payload.length > 20000
          ? frame.payload.slice(0, 20000) + `[TRUNCATED ${frame.payload.length}]`
          : frame.payload;
      } else {
        // Binary frame — store as hex for analysis
        const buf = Buffer.from(frame.payload);
        entry.encoding = "hex";
        entry.byteLength = buf.length;
        if (buf.length <= 50000) {
          entry.payload = buf.toString("hex");
        } else {
          entry.payload = buf.subarray(0, 50000).toString("hex") + `[TRUNCATED ${buf.length}]`;
        }
      }

      data.wsFrames.push(entry);
    });

    ws.on("framesent", (frame) => {
      data.meta.totalWsFrames++;
      const entry = {
        type: "send",
        time: new Date().toISOString(),
        url: wsUrl.slice(0, 150),
      };

      if (typeof frame.payload === "string") {
        entry.encoding = "text";
        entry.payload = frame.payload.length > 20000
          ? frame.payload.slice(0, 20000) + `[TRUNCATED ${frame.payload.length}]`
          : frame.payload;
      } else {
        const buf = Buffer.from(frame.payload);
        entry.encoding = "hex";
        entry.byteLength = buf.length;
        if (buf.length <= 50000) {
          entry.payload = buf.toString("hex");
        } else {
          entry.payload = buf.subarray(0, 50000).toString("hex") + `[TRUNCATED ${buf.length}]`;
        }
      }

      data.wsFrames.push(entry);

      // Log outgoing WS messages (these are often bet-related)
      if (typeof frame.payload === "string" && frame.payload.length < 500) {
        console.log(`  ⚡→ WS send: ${frame.payload.slice(0, 200)}`);
      }
    });

    ws.on("close", () => {
      data.wsFrames.push({
        type: "close",
        time: new Date().toISOString(),
        url: wsUrl.slice(0, 150),
      });
    });
  });

  // ── Console messages ──────────────────────────────────────────────────
  page.on("console", (msg) => {
    data.meta.totalConsoleMessages++;
    data.consoleMessages.push({
      time: new Date().toISOString(),
      level: msg.type(),
      text: msg.text().slice(0, 2000),
      page: label,
    });
  });
}

// Instrument the main page
const page = await context.newPage();
instrumentPage(page, "main");

// Catch popup windows / new tabs (some books open bet confirmation in popups)
context.on("page", (newPage) => {
  const label = `popup-${Date.now()}`;
  console.log(`  📎 New tab/popup opened — instrumenting as "${label}"`);
  instrumentPage(newPage, label);
});

// ── Periodic Screenshots ────────────────────────────────────────────────────
let screenshotCount = 0;
const screenshotTimer = setInterval(async () => {
  try {
    const pages = context.pages();
    for (const p of pages) {
      if (p.isClosed()) continue;
      screenshotCount++;
      const filename = `screenshot-${String(screenshotCount).padStart(4, "0")}.png`;
      const filepath = join(outDir, filename);
      await p.screenshot({ path: filepath, fullPage: false });
      data.screenshots.push({
        seq: screenshotCount,
        time: new Date().toISOString(),
        file: filename,
        url: p.url(),
        title: await p.title().catch(() => ""),
      });
      data.meta.totalScreenshots = screenshotCount;
    }
  } catch {
    // Page might be navigating
  }
}, SCREENSHOT_INTERVAL_MS);

// ── Auto-save ───────────────────────────────────────────────────────────────
function saveData(final = false) {
  if (saving) return;
  saving = true;
  try {
    const filename = final ? "capture.json" : "capture-autosave.json";
    const filepath = join(outDir, filename);
    writeFileSync(filepath, JSON.stringify(data, null, 2));
    const sizeMB = (JSON.stringify(data).length / (1024 * 1024)).toFixed(1);
    if (!final) {
      console.log(`  💾 Auto-saved (${sizeMB} MB, ${data.meta.totalRequests} req, ${data.meta.totalWsFrames} ws frames)`);
    }
  } catch (err) {
    console.error("  Save error:", err.message);
  }
  saving = false;
}

const autoSaveTimer = setInterval(() => saveData(false), AUTO_SAVE_INTERVAL_MS);

// ── Status line ─────────────────────────────────────────────────────────────
const statusTimer = setInterval(() => {
  process.stdout.write(
    `\r  📊 ${data.meta.totalRequests} requests | ${data.meta.totalResponses} responses | ${data.meta.totalWsFrames} ws frames | ${screenshotCount} screenshots    `
  );
}, 5000);

// ── Navigate ────────────────────────────────────────────────────────────────
await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

console.log("\n  ✅ Browser ready — go place your bet!\n");

// ── Final save on exit ──────────────────────────────────────────────────────
async function finalSaveAndExit() {
  console.log("\n\n  Saving final capture...");

  clearInterval(autoSaveTimer);
  clearInterval(screenshotTimer);
  clearInterval(statusTimer);

  // Take a final screenshot
  try {
    screenshotCount++;
    await page.screenshot({
      path: join(outDir, `screenshot-${String(screenshotCount).padStart(4, "0")}-final.png`),
      fullPage: true,
    });
  } catch {}

  // Dump all cookies
  try {
    data.cookies = await context.cookies();
    console.log(`  🍪 Captured ${data.cookies.length} cookies`);
  } catch {}

  // Dump localStorage and sessionStorage from all pages
  try {
    for (const p of context.pages()) {
      if (p.isClosed()) continue;
      const url = p.url();
      try {
        const storage = await p.evaluate(() => {
          const ls = {};
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            ls[key] = localStorage.getItem(key);
          }
          const ss = {};
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            ss[key] = sessionStorage.getItem(key);
          }
          return { localStorage: ls, sessionStorage: ss };
        });
        data.localStorage[url] = storage.localStorage;
        data.sessionStorage[url] = storage.sessionStorage;
        const lsKeys = Object.keys(storage.localStorage).length;
        const ssKeys = Object.keys(storage.sessionStorage).length;
        console.log(`  🗄️  Captured storage: ${lsKeys} localStorage + ${ssKeys} sessionStorage keys`);
      } catch {}
    }
  } catch {}

  // Final metadata
  data.meta.endTime = new Date().toISOString();

  // Save final file
  saveData(true);

  const sizeMB = (JSON.stringify(data).length / (1024 * 1024)).toFixed(1);
  console.log(`
╔══════════════════════════════════════════════════════╗
║                  CAPTURE COMPLETE                    ║
╠══════════════════════════════════════════════════════╣
║  Requests:    ${String(data.meta.totalRequests).padEnd(39)}║
║  Responses:   ${String(data.meta.totalResponses).padEnd(39)}║
║  WS Frames:   ${String(data.meta.totalWsFrames).padEnd(39)}║
║  Screenshots: ${String(screenshotCount).padEnd(39)}║
║  Cookies:     ${String(data.cookies.length).padEnd(39)}║
║  File size:   ${(sizeMB + " MB").padEnd(39)}║
║  Output:      ${outDir.slice(-39).padEnd(39)}║
╚══════════════════════════════════════════════════════╝
`);
  console.log(`  Send the entire "${outDir.split(/[/\\]/).pop()}" folder.\n`);

  await browser.close();
  process.exit(0);
}

process.on("SIGINT", finalSaveAndExit);
process.on("SIGTERM", finalSaveAndExit);

// Catch crashes too
process.on("uncaughtException", (err) => {
  console.error("\n  ❌ Crash:", err.message);
  saveData(true);
  process.exit(1);
});

// Keep alive
await new Promise(() => {});
