#!/usr/bin/env node
/**
 * host-auth.mjs — Host-side SSO authentication capture template.
 *
 * Runs on the macOS/Windows host (NOT in a container) to capture SSO session
 * cookies via a real browser. The host machine has device certificates that
 * satisfy Conditional Access Policies — containers don't.
 *
 * This is a TEMPLATE — configure the constants below for your service, or
 * copy this file into your MCP's scripts/ directory and customize.
 *
 * ─── How it fits into the thesun ecosystem ──────────────────────────────────
 *
 *   thesun generates MCP servers for any platform. For platforms behind
 *   corporate SSO, the generated MCP uses browser-captured cookies for auth.
 *   When those cookies expire, sso-reauth-fix triggers this script to get
 *   fresh ones without human intervention.
 *
 *   Flow: MCP 401 → reauth interceptor → host-auth.mjs → fresh cookies → retry
 *
 * ─── Quick Start ────────────────────────────────────────────────────────────
 *
 *   1. Set the configuration constants below (SERVICE_NAME, etc.)
 *   2. Store credentials in env vars or macOS Keychain
 *   3. Run:  node host-auth.mjs [--headless]
 *
 * ─── Credential Sources (checked in order) ──────────────────────────────────
 *
 *   1. Environment variables: <SERVICE>_USERNAME, <SERVICE>_PASSWORD
 *   2. macOS Keychain (label-based):
 *        security add-generic-password -l "sso-email" -a "me" -s "sso" -w "user@corp.com"
 *        security add-generic-password -l "sso-password" -a "me" -s "sso" -w "..."
 *   3. TOTP_SECRET env var (optional, for automated MFA)
 *
 * ─── Output ─────────────────────────────────────────────────────────────────
 *
 *   ~/.<service>-mcp/cookies.json   — auth headers ready for fetch()
 *   ./.cookie-cache.json            — same, in cwd for direct MCP use
 */

import { firefox } from "playwright";
import { createHmac } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION — Edit these for your service
// ═══════════════════════════════════════════════════════════════════════════

const SERVICE_NAME = "myservice";
const INSTANCE_URL = process.env[`${SERVICE_NAME.toUpperCase()}_INSTANCE_URL`] || "";

// Optional endpoints — set to "" to skip
const SESSION_INFO_ENDPOINT = "";                // e.g. "/api/now/ui/user/session_info"
const VERIFY_ENDPOINT       = "";                // e.g. "/api/now/table/sys_user?sysparm_limit=1"
const CSRF_GLOBAL_VAR       = "";                // e.g. "g_ck" for ServiceNow
const CSRF_HEADER_NAME      = "X-CSRF-Token";   // e.g. "X-UserToken" for ServiceNow

// macOS Keychain labels
const KEYCHAIN_EMAIL_LABEL    = "sso-email";
const KEYCHAIN_PASSWORD_LABEL = "sso-password";

// ═══════════════════════════════════════════════════════════════════════════

if (!INSTANCE_URL) {
  console.error(`❌ Set ${SERVICE_NAME.toUpperCase()}_INSTANCE_URL environment variable`);
  process.exit(1);
}

const TARGET_HOST = new URL(INSTANCE_URL).hostname;
const CONFIG_DIR  = join(homedir(), `.${SERVICE_NAME}-mcp`);
const COOKIE_FILE = join(CONFIG_DIR, "cookies.json");
const HEADLESS    = process.argv.includes("--headless");

mkdirSync(CONFIG_DIR, { recursive: true });

// ─── TOTP Generator ─────────────────────────────────────────────────────────

function generateTOTP(base32Secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const cleaned = base32Secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const c of cleaned) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const secretBytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < secretBytes.length; i++)
    secretBytes[i] = parseInt(bits.substring(i * 8, i * 8 + 8), 2);
  const time = Math.floor(Date.now() / 30000);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(time));
  const hmac = createHmac("sha1", secretBytes).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      (hmac[offset + 1] << 16) |
      (hmac[offset + 2] << 8) |
      hmac[offset + 3]) %
    1000000;
  return code.toString().padStart(6, "0");
}

// ─── SSO Form Selectors ─────────────────────────────────────────────────────
// Covers Azure AD, Okta, Ping, ADFS, and most corporate SSO providers.

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
  let email    = process.env[`${SERVICE_NAME.toUpperCase()}_USERNAME`] || "";
  let password = process.env[`${SERVICE_NAME.toUpperCase()}_PASSWORD`] || "";
  const totpSecret = process.env.TOTP_SECRET || "";

  if (!email || !password) {
    const { execSync } = await import("node:child_process");
    const getKey = (label) => {
      try {
        return execSync(`security find-generic-password -l "${label}" -w`, {
          encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch { return ""; }
    };
    email    = email    || getKey(KEYCHAIN_EMAIL_LABEL);
    password = password || getKey(KEYCHAIN_PASSWORD_LABEL);
    if (!email || !password) {
      console.error(
        `❌ Set ${SERVICE_NAME.toUpperCase()}_USERNAME + ${SERVICE_NAME.toUpperCase()}_PASSWORD ` +
        `env vars, or add ${KEYCHAIN_EMAIL_LABEL}/${KEYCHAIN_PASSWORD_LABEL} to macOS Keychain`
      );
      process.exit(1);
    }
  }

  console.log(`🔐 ${SERVICE_NAME} host-side auth (${HEADLESS ? "headless" : "visible"} browser)`);
  console.log(`   Instance: ${INSTANCE_URL}`);
  console.log(`   User: ${email}`);

  const browser = await firefox.launch({
    headless: HEADLESS,
    firefoxUserPrefs: {
      "security.default_personal_cert": "Select Automatically",
      "security.enterprise_roots.enabled": true,
      "security.certerrors.mitm.auto_enable_enterprise_roots": true,
      "security.insecure_field_warning.contextual.enabled": false,
      "browser.safebrowsing.enabled": false,
    },
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

    // ── SSO login loop ──────────────────────────────────────────────────
    for (let step = 0; step < 25; step++) {
      const url = page.url();
      const onTarget = url.includes(TARGET_HOST) && !url.includes("login.microsoftonline.com");
      const hasLoginForm = await page.$$(
        'input[type="email"]:visible, input[type="password"]:visible, ' +
        'input[name="loginfmt"]:visible, input[name="passwd"]:visible, input[name="otc"]:visible'
      );

      if (onTarget && hasLoginForm.length === 0) {
        console.log("✅ Landed on target — SSO complete");
        break;
      }

      let acted = false;

      // Email
      for (const sel of EMAIL_SELECTORS) {
        const el = await page.$(sel).catch(() => null);
        if (!el) continue;
        if (!(await el.isVisible().catch(() => false))) continue;
        if (await el.inputValue().catch(() => "filled")) continue;
        console.log("📧 Filling email...");
        await el.fill(email);
        const btn = await page.$(
          'input[type="submit"]:visible, button[type="submit"]:visible, #idSIButton9:visible'
        );
        if (btn) await btn.click().catch(() => {});
        await page.waitForNavigation({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
        acted = true;
        break;
      }
      if (acted) continue;

      // Password
      for (const sel of PW_SELECTORS) {
        const el = await page.$(sel).catch(() => null);
        if (!el) continue;
        if (!(await el.isVisible().catch(() => false))) continue;
        if (await el.inputValue().catch(() => "filled")) continue;
        console.log("🔑 Filling password...");
        await el.fill(password);
        const btn = await page.$(
          'input[type="submit"]:visible, button[type="submit"]:visible, #idSIButton9:visible'
        );
        if (btn) await btn.click().catch(() => {});
        await page.waitForNavigation({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
        acted = true;
        break;
      }
      if (acted) continue;

      // TOTP
      if (totpSecret) {
        for (const sel of TOTP_SELECTORS) {
          const el = await page.$(sel).catch(() => null);
          if (!el) continue;
          if (!(await el.isVisible().catch(() => false))) continue;
          if (await el.inputValue().catch(() => "filled")) continue;
          console.log("🔢 Filling TOTP code...");
          await el.fill(generateTOTP(totpSecret));
          const btn = await page.$(
            'input[type="submit"]:visible, button[type="submit"]:visible, ' +
            '#idSIButton9:visible, #idSubmit_SAOTCC_Continue:visible'
          );
          if (btn) await btn.click().catch(() => {});
          await page.waitForNavigation({ timeout: 8000 }).catch(() => {});
          await page.waitForTimeout(2000);
          acted = true;
          break;
        }
        if (acted) continue;
      }

      // Consent / Stay signed in
      for (const sel of CONSENT_SELECTORS) {
        const btn = await page.$(sel).catch(() => null);
        if (btn && (await btn.isVisible().catch(() => false))) {
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

    // ── Ensure we landed on target ────────────────────────────────────────
    if (!page.url().includes(TARGET_HOST)) {
      console.log("🔄 Navigating back to target...");
      await page.goto(INSTANCE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(5000);
    }

    // ── Extract CSRF / session tokens ─────────────────────────────────────
    let csrfToken = "";

    if (SESSION_INFO_ENDPOINT) {
      try {
        csrfToken = await page.evaluate(async (endpoint) => {
          const r = await fetch(endpoint, {
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          });
          if (!r.ok) return "";
          const d = await r.json();
          return d?.result?.g_ck || d?.csrfToken || d?.token || "";
        }, SESSION_INFO_ENDPOINT);
      } catch (e) {
        console.warn("⚠️  Could not get CSRF from endpoint:", e.message);
      }
    }

    if (!csrfToken && CSRF_GLOBAL_VAR) {
      for (const frame of page.frames()) {
        try {
          csrfToken = await frame.evaluate((v) => window[v] || "", CSRF_GLOBAL_VAR);
          if (csrfToken) break;
        } catch { /* cross-origin */ }
      }
    }

    if (!csrfToken) {
      try {
        csrfToken = await page.evaluate(() => {
          const meta = document.querySelector('meta[name="csrf-token"], meta[name="_csrf"]');
          return meta?.getAttribute("content") || "";
        });
      } catch { /* ignore */ }
    }

    // ── Warm the API session ──────────────────────────────────────────────
    if (VERIFY_ENDPOINT) {
      try {
        await page.evaluate(async (ep) => {
          await fetch(ep, { credentials: "same-origin", headers: { Accept: "application/json" } });
        }, VERIFY_ENDPOINT);
      } catch { /* ignore */ }
    }

    // ── Capture cookies ───────────────────────────────────────────────────
    const allCookies = await context.cookies();
    const relevantCookies = allCookies.filter(
      (c) => c.domain.includes(TARGET_HOST) || c.domain.includes("microsoftonline.com")
    );
    const cookieHeader = relevantCookies.map((c) => `${c.name}=${c.value}`).join("; ");

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

    try {
      writeFileSync(join(process.cwd(), ".cookie-cache.json"), JSON.stringify(result, null, 2));
    } catch { /* cwd not writable */ }

    if (VERIFY_ENDPOINT) {
      console.log("\n🧪 Verifying...");
      const resp = await fetch(`${INSTANCE_URL}${VERIFY_ENDPOINT}`, { headers });
      if (resp.ok) {
        console.log("✅ Verified — API responding");
      } else {
        console.error(`⚠️  Verification failed: ${resp.status}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error("❌ Auth failed:", e.message);
  process.exit(1);
});
