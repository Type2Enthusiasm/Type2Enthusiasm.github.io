#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const targetUrl = process.argv[2] || "http://127.0.0.1:8791/index.html";
const artifactsDir = path.join(process.cwd(), ".artifacts");
mkdirSync(artifactsDir, { recursive: true });

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/home/clio/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No Chromium/Chrome binary found. Set CHROME_BIN to run browser smoke checks.");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, attempts = 80) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw lastError;
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message}: ${message.error.data || ""}`));
        else resolve(message.result || {});
      } else if (message.method) {
        this.events.push(message);
      }
    });
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 10000);
    });
  }

  close() {
    this.ws.close();
  }
}

async function evalValue(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result.result?.value;
}

async function waitFor(cdp, expression, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await evalValue(cdp, expression);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function capture(cdp, filename, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await sleep(250);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const out = path.join(artifactsDir, filename);
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  return out;
}

const chrome = findChrome();
const port = 9300 + Math.floor(Math.random() * 500);
const profileDir = path.join(os.tmpdir(), `website-smoke-${process.pid}`);
rmSync(profileDir, { recursive: true, force: true });

const browser = spawn(chrome, [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });

let cdp;
try {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const target = targets.find((entry) => entry.type === "page") || targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error("No page target from Chromium");

  cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  await cdp.send("Page.navigate", { url: targetUrl });
  await waitFor(cdp, "document.readyState === 'complete'", 10000);
  await sleep(500);

  const initial = await evalValue(cdp, `(() => ({
    title: document.title,
    stage: document.querySelector('[data-puzzle-stage]')?.dataset.puzzleStage,
    resetHidden: document.querySelector('[data-puzzle-reset]')?.hidden,
    rewardHidden: document.querySelector('[data-puzzle-reward]')?.hidden,
    canvasCount: document.querySelectorAll('[data-puzzle-canvas], .puzzle-overlay').length,
    triggerExists: Boolean(document.querySelector('[data-puzzle-trigger]')),
    headerBox: (() => {
      const row = document.querySelector('.header-row')?.getBoundingClientRect();
      const title = document.querySelector('.site-title')?.getBoundingClientRect();
      const social = document.querySelector('.site-social')?.getBoundingClientRect();
      return row && title && social ? { rowH: row.height, titleRight: title.right, socialLeft: social.left } : null;
    })()
  }))()`);

  if (initial.stage !== "static") throw new Error(`Expected initial stage static, got ${initial.stage}`);
  if (!initial.resetHidden) throw new Error("Reset button should be hidden on fresh load");
  if (!initial.rewardHidden) throw new Error("Reward should be hidden on fresh load");
  if (initial.canvasCount !== 0) throw new Error("Stale puzzle canvas/overlay is present");
  if (!initial.triggerExists) throw new Error("Puzzle trigger missing");

  await capture(cdp, "cleanup-pass-1-home-desktop.png", 1280, 900);
  await capture(cdp, "cleanup-pass-1-home-mobile.png", 390, 900);

  await evalValue(cdp, "document.querySelector('[data-puzzle-trigger]').click()");
  await waitFor(cdp, "document.querySelector('[data-puzzle-stage]')?.dataset.puzzleStage === 'active'", 10000);
  await waitFor(cdp, "document.querySelectorAll('.puzzle-glyph').length > 0", 10000);

  const active = await evalValue(cdp, `(() => ({
    stage: document.querySelector('[data-puzzle-stage]')?.dataset.puzzleStage,
    glyphs: document.querySelectorAll('.puzzle-glyph').length,
    resetHidden: document.querySelector('[data-puzzle-reset]')?.hidden,
    layerHidden: document.querySelector('[data-puzzle-glyph-layer]')?.hidden
  }))()`);

  if (active.stage !== "active") throw new Error(`Expected active stage, got ${active.stage}`);
  if (active.glyphs <= 0) throw new Error("Puzzle activation produced no glyphs");
  if (active.resetHidden) throw new Error("Reset button should be visible while puzzle is active");
  if (active.layerHidden) throw new Error("Glyph layer should be visible while puzzle is active");

  await evalValue(cdp, "document.querySelector('[data-puzzle-reset]').click()");
  await waitFor(cdp, "document.querySelector('[data-puzzle-stage]')?.dataset.puzzleStage === 'static'", 10000);
  await sleep(250);

  const reset = await evalValue(cdp, `(() => ({
    stage: document.querySelector('[data-puzzle-stage]')?.dataset.puzzleStage,
    resetHidden: document.querySelector('[data-puzzle-reset]')?.hidden,
    layerHidden: document.querySelector('[data-puzzle-glyph-layer]')?.hidden,
    glyphs: document.querySelectorAll('.puzzle-glyph').length
  }))()`);

  if (reset.stage !== "static") throw new Error(`Expected reset stage static, got ${reset.stage}`);
  if (!reset.resetHidden) throw new Error("Reset button should be hidden after reset");
  if (!reset.layerHidden) throw new Error("Glyph layer should be hidden after reset");

  const badEvents = cdp.events.filter((event) => {
    if (event.method === "Runtime.exceptionThrown") return true;
    if (event.method === "Log.entryAdded") {
      return ["error", "warning"].includes(event.params?.entry?.level) && !/favicon/i.test(event.params?.entry?.text || "");
    }
    return false;
  });

  if (badEvents.length) {
    throw new Error(`Browser logged ${badEvents.length} error/warning event(s): ${JSON.stringify(badEvents.slice(0, 3))}`);
  }

  console.log("Browser smoke passed:");
  console.log(`- loaded ${targetUrl}`);
  console.log(`- fresh stage static; reset/reward hidden; stale canvas absent`);
  console.log(`- captured ${path.join(".artifacts", "cleanup-pass-1-home-desktop.png")}`);
  console.log(`- captured ${path.join(".artifacts", "cleanup-pass-1-home-mobile.png")}`);
  console.log(`- puzzle activated with ${active.glyphs} glyphs and reset returned to static`);
} finally {
  if (cdp) cdp.close();
  browser.kill("SIGTERM");
  await sleep(300);
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {
    // Chromium can leave files behind for a moment after SIGTERM. The temp
    // profile path includes the current process id and is safe to clean later.
  }
}
