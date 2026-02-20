#!/usr/bin/env node
/**
 * Host-side SSO authentication script template.
 *
 * Runs on macOS host (not in container) to capture SSO cookies via browser.
 * The host has device certificates that satisfy Conditional Access Policies.
 *
 * Cookies are saved to ~/.<service>-mcp/cookies.json, which can be
 * volume-mounted into a container for immediate use.
 *
 * Configuration:
 *   Environment variables:
 *     <SERVICE>_INSTANCE_URL  — target instance URL (required)
 *     <SERVICE>_USERNAME      — SSO email/username (or use macOS Keychain)
 *     <SERVICE>_PASSWORD      — SSO password (or use macOS Keychain)
 *     TOTP_SECRET             — base32-encoded TOTP secret (optional, for MFA)
 *
 *   macOS Keychain labels (alternative to env vars):
 *     sso-email               — email address
 *     sso-password            — password
 *
 * Usage: node host-auth.mjs [--headless]
 */

import { firefox } from "playwright";
import { createHmac } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ─── Configuration ──────────────────────────────────────────────────────────
// Change these for your service
const SERVICE_NAME = "myservice";
const CONFIG_DIR = join(homedir(), `.${SERVICE_NAME}-mcp`);
const COOKIE_FILE = join(CONFIG_DIR, "cookies.json");
const HEADLESS = process.argv.includes("--headless");

const INSTANCE_URL = process.env[`${SERVICE_NAME.toUpperCase()}_INSTANCE_URL`] || "";
if (!INSTANCE_URL) {
  console.error(`❌ Set ${SERVICE_NAME.toUpperCase()}_INSTANCE_URL environment variable`);
  process.exit(1);
}
const TARGET_HOST = new URL(INSTANCE_URL).hostname;

// Optional: REST API session token endpoint (set to "" to skip)
// e.g., "/api/now/ui/user/session_info" for ServiceNow
const SESSION_INFO_ENDPOINT = "";

// Optional: REST API verification endpoint (set to "" to skip)
// e.g., "/api/now/table/sys_user?sysparm_limit=1&sysparm_fields=sys_id"
const VERIFY_ENDPOINT = "";

// Optional: CSRF token global variable name (set to "" to skip)
// e.g., "g_ck" for ServiceNow
const CSRF_GLOBAL_VAR = "";

// CSRF header name to use when sending the token
// e.g., "X-UserToken" for ServiceNow
const CSRF_HEADER_NAME = "X-CSRF-Token";

mkdirSync(CONFIG_DIR, { recursive: true });

// ─── TOTP Generator ─────────────────────────────────────────────────────────
function generateTOTP(base32Secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = base32Secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of cleaned) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const secretBytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < secretBytes.length; i++) secretBytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  const time = Math.floor(Date.now() / 30000);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(time));
  const hmac = createHmac("sha1", secretBytes).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
  return code.toString().padStart(6, "0");
}

// ─── SSO Selectors ──────────────────────────────────────────────────────────
const EMAIL_SELECTORS = [
  'input[name="loginfmt"]', 'input[type="email"]', 'input[name="email"]',
  'input[name="username"]', 'input[name="user"]',
];
const PW_SELECTORS = [
  'input[name="passwd"]', 'input[type="password"]', 'input[name="password"]',
];
const TOTP_SELECTORS = [
  'input[name="otc"]', 'input#idTxtBx_SAOTCC_OTC', 'input[placeholder*="code"]',
];
const CONSENT_SELECTORS = [
  '#idSIButton9', '#idBtn_Back', '#acceptButton',
  'button:has-text("Yes")', 'button:has-text("Accept")', 'button:has-text("Continue")',
  'button:has-text("Stay signed in")', 'button:has-text("Approve")',
];

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  let email = process.env[`${SERVICE_NAME.toUpperCase()}_USERNAME`] || "";
  let password = process.env[`${SERVICE_NAME.toUpperCase()}_PASSWORD`] || "";
  const totpSecret = process.env.TOTP_SECRET || "";

  // Fall back to macOS Keychain
  if (!email || !password) {
    const { execSync } = await import("node:child_process");
    const getKey = (label) => {
      try {
        return execSync(`security find-generic-password -l "${label}" -w`, {
          encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch { return ""; }
    };
    email = email || getKey("sso-email");
    password = password || getKey("sso-password");
    if (!email || !password) {
      console.error(`❌ Set ${SERVICE_NAME.toUpperCase()}_USERNAME + ${SERVICE_NAME.toUpperCase()}_PASSWORD env vars, or add sso-email/sso-password to macOS Keychain`);
      process.exit(1);
    }
  }

  console.log(`🔐 ${SERVICE_NAME} host-side auth (${HEADLESS ? "headless" : "visible"} browser)`);
  console.log(`   Instance: ${INSTANCE_URL}`);
  console.log(`   User: ${email}`);

  const browser = await firefox.launch({
    headless: HEADLESS,
    firefoxUserPrefs: { "security.default_personal_cert": "Select Automatically" },
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    console.log("🌐 Navigating to target...");
    await page.goto(INSTANCE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3000);

    // ── SSO login loop ────────────────────────────────────────────────────
    for (let step = 0; step < 25; step++) {
      const url = page.url();
      const onTarget = url.includes(TARGET_HOST) && !url.includes("login.microsoftonline.com");
      const hasLoginForm = await page.$$('input[type="email"]:visible, input[type="password"]:visible, input[name="loginfmt"]:visible, input[name="passwd"]:visible, input[name="otc"]:visible');

      if (onTarget && hasLoginForm.length === 0) {
        console.log("✅ Landed on target — SSO complete");
        break;
      }

      let acted = false;

      // Email step
      for (const sel of EMAIL_SELECTORS) {
        const el = await page.$(sel).catch(() => null);
        if (!el) continue;
        const visible = await el.isVisible().catch(() => false);
        const val = await el.inputValue().catch(() => "filled");
        if (visible && !val) {
          console.log("📧 Filling email...");
          await el.fill(email);
          const btn = await page.$('input[type="submit"]:visible, button[type="submit"]:visible, #idSIButton9:visible');
          if (btn) await btn.click().catch(() => {});
          await page.waitForNavigation({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(2000);
          acted = true;
          break;
        }
      }
      if (acted) continue;

      // Password step
      for (const sel of PW_SELECTORS) {
        const el = await page.$(sel).catch(() => null);
        if (!el) continue;
        const visible = await el.isVisible().catch(() => false);
        const val = await el.inputValue().catch(() => "filled");
        if (visible && !val) {
          console.log("🔑 Filling password...");
          await el.fill(password);
          const btn = await page.$('input[type="submit"]:visible, button[type="submit"]:visible, #idSIButton9:visible');
          if (btn) await btn.click().catch(() => {});
          await page.waitForNavigation({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(2000);
          acted = true;
          break;
        }
      }
      if (acted) continue;

      // TOTP step
      if (totpSecret) {
        for (const sel of TOTP_SELECTORS) {
          const el = await page.$(sel).catch(() => null);
          if (!el) continue;
          const visible = await el.isVisible().catch(() => false);
          const val = await el.inputValue().catch(() => "filled");
          if (visible && !val) {
            const code = generateTOTP(totpSecret);
            console.log("🔢 Filling TOTP code...");
            await el.fill(code);
            const btn = await page.$('input[type="submit"]:visible, button[type="submit"]:visible, #idSIButton9:visible, #idSubmit_SAOTCC_Continue:visible');
            if (btn) await btn.click().catch(() => {});
            await page.waitForNavigation({ timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(2000);
            acted = true;
            break;
          }
        }
        if (acted) continue;
      }

      // Consent / Stay signed in
      for (const sel of CONSENT_SELECTORS) {
        const btn = await page.$(sel).catch(() => null);
        if (btn && await btn.isVisible().catch(() => false)) {
          console.log("👆 Clicking consent/continue...");
          await btn.click().catch(() => {});
          await page.waitForTimeout(3000);
          acted = true;
          break;
        }
      }

      if (!acted) {
        console.log(`   Step ${step}: waiting... (${url.substring(0, 80)})`);
        await page.waitForTimeout(5000);
      }
    }

    // ── Ensure we're on the target ────────────────────────────────────────
    if (!page.url().includes(TARGET_HOST)) {
      console.log("🔄 Navigating back to target...");
      await page.goto(INSTANCE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(5000);
    }

    // ── CSRF / session token extraction ───────────────────────────────────
    let csrfToken = "";

    // Method 1: Fetch from a session-info API endpoint
    if (SESSION_INFO_ENDPOINT) {
      try {
        csrfToken = await page.evaluate(async (endpoint) => {
          const r = await fetch(endpoint, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          });
          if (r.ok) {
            const d = await r.json();
            // Adapt this path to your service's response structure
            return d?.result?.g_ck || d?.csrfToken || d?.token || "";
          }
          return "";
        }, SESSION_INFO_ENDPOINT);
      } catch (e) {
        console.warn("⚠️  Could not get CSRF token from endpoint:", e.message);
      }
    }

    // Method 2: Extract from window globals
    if (!csrfToken && CSRF_GLOBAL_VAR) {
      for (const frame of page.frames()) {
        try {
          csrfToken = await frame.evaluate((varName) => window[varName] || "", CSRF_GLOBAL_VAR);
          if (csrfToken) break;
        } catch { /* cross-origin frame */ }
      }
    }

    // Method 3: Extract from page meta tags or cookies
    if (!csrfToken) {
      try {
        csrfToken = await page.evaluate(() => {
          const meta = document.querySelector('meta[name="csrf-token"], meta[name="_csrf"]');
          return meta?.getAttribute("content") || "";
        });
      } catch { /* ignore */ }
    }

    // ── Warm the API session (optional) ───────────────────────────────────
    if (VERIFY_ENDPOINT) {
      try {
        await page.evaluate(async (endpoint) => {
          await fetch(endpoint, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          });
        }, VERIFY_ENDPOINT);
      } catch { /* ignore */ }
    }

    // ── Capture cookies ───────────────────────────────────────────────────
    const allCookies = await context.cookies();
    const relevantCookies = allCookies.filter(c =>
      c.domain.includes(TARGET_HOST) ||
      c.domain.includes("microsoftonline.com")
    );

    const cookieHeader = relevantCookies.map(c => `${c.name}=${c.value}`).join("; ");

    const headers = {
      Cookie: cookieHeader,
      Accept: "application/json",
      ...(csrfToken ? { [CSRF_HEADER_NAME]: csrfToken } : {}),
    };

    const result = {
      headers,
      capturedAt: Date.now(),
      instanceUrl: INSTANCE_URL,
      cookieCount: relevantCookies.length,
      hasCsrfToken: !!csrfToken,
    };

    writeFileSync(COOKIE_FILE, JSON.stringify(result, null, 2));
    console.log(`\n✅ Auth captured!`);
    console.log(`   ${relevantCookies.length} cookies, csrf=${!!csrfToken}`);
    console.log(`   Saved to: ${COOKIE_FILE}`);

    // Also write a .cookie-cache.json in cwd for direct use
    try {
      writeFileSync(join(process.cwd(), ".cookie-cache.json"), JSON.stringify(result, null, 2));
    } catch { /* ignore if cwd is not writable */ }

    // ── Verify cookies work ───────────────────────────────────────────────
    if (VERIFY_ENDPOINT) {
      console.log("\n🧪 Verifying...");
      const verifyResp = await fetch(`${INSTANCE_URL}${VERIFY_ENDPOINT}`, { headers });
      if (verifyResp.ok) {
        console.log("✅ Verified — API responding");
      } else {
        console.error(`⚠️  Verification failed: ${verifyResp.status}`);
      }
    }

  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error("❌ Auth failed:", e.message);
  process.exit(1);
});
