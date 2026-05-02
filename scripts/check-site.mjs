#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

function note(message) {
  notes.push(message);
}

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

function stripHashAndQuery(value) {
  return value.split("#")[0].split("?")[0];
}

function isExternalRef(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|#|$)/i.test(value);
}

function localTargetExists(fromFile, rawRef) {
  const clean = stripHashAndQuery(rawRef.trim());
  if (!clean || isExternalRef(clean)) return true;

  let decoded;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }

  const baseDir = path.dirname(path.join(root, fromFile));
  let target = path.resolve(baseDir, decoded);
  if (!target.startsWith(root + path.sep)) {
    fail(`${fromFile}: local ref escapes repo root: ${rawRef}`);
    return false;
  }

  if (existsSync(target) && statSync(target).isDirectory()) {
    target = path.join(target, "index.html");
  }

  if (!existsSync(target)) {
    fail(`${fromFile}: missing local ref ${rawRef}`);
    return false;
  }
  return true;
}

function allMatches(text, regex) {
  return [...text.matchAll(regex)].map((match) => match[1]);
}

const htmlFiles = readdirSync(root)
  .filter((name) => name.endsWith(".html"))
  .sort();

if (htmlFiles.length === 0) {
  fail("no root HTML files found");
}

const visiblePages = new Map([
  ["index.html", "Home"],
  ["research.html", "Research"],
  ["contact.html", "Contact"],
]);

for (const file of htmlFiles) {
  const html = read(file);
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  if (!title) fail(`${file}: missing non-empty <title>`);

  const refs = [
    ...allMatches(html, /\bhref=["']([^"']+)["']/gi),
    ...allMatches(html, /\bsrc=["']([^"']+)["']/gi),
  ];
  for (const ref of refs) localTargetExists(file, ref);

  const ids = allMatches(html, /\bid=["']([^"']+)["']/gi);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) fail(`${file}: duplicate id "${id}"`);
    seen.add(id);
  }

  if (visiblePages.has(file)) {
    const label = visiblePages.get(file);
    const currentNavPattern = new RegExp(`<a\\s+[^>]*href=["']${file}["'][^>]*aria-current=["']page["'][^>]*>${label}<\\/a>`, "i");
    if (!currentNavPattern.test(html)) {
      fail(`${file}: expected ${label} nav link to have aria-current="page"`);
    }
  }
}

const index = read("index.html");
const requiredPuzzleFragments = [
  "data-puzzle-stage=\"static\"",
  "data-puzzle-walls",
  "data-puzzle-trigger",
  "data-puzzle-reward",
  "data-puzzle-quote-stack",
  "data-puzzle-glyph-layer",
  "data-puzzle-reset",
  "data-puzzle-separator",
  "data-puzzle-floor",
  "type=\"module\" src=\"puzzle.js\"",
];

for (const fragment of requiredPuzzleFragments) {
  if (!index.includes(fragment)) {
    fail(`index.html: missing puzzle contract fragment ${fragment}`);
  }
}

if (/puzzle[^<]{0,80}on each page/i.test(index)) {
  fail('index.html: copy says the puzzle is "on each page" but only index.html loads puzzle.js');
}

if (index.includes("data-puzzle-canvas") || index.includes("puzzle-overlay")) {
  fail("index.html: stale puzzle canvas/overlay markup should not return");
}

if (existsSync(path.join(root, "skills-lock.json"))) {
  fail("skills-lock.json is not a runtime website asset; keep it out of this repo unless documented");
}

const puzzleSource = read("puzzle.js");
if (puzzleSource.includes("forcePuzzleReveal") || /addEventListener\(["']keydown["']/.test(puzzleSource)) {
  fail("puzzle.js: production debug keyboard shortcuts should not return without an explicit debug gate");
}

for (const file of ["puzzle.js", "pretext.js"]) {
  if (!existsSync(path.join(root, file))) {
    fail(`missing ${file}`);
    continue;
  }
  try {
    execFileSync(process.execPath, ["--check", file], { cwd: root, stdio: "pipe" });
  } catch (error) {
    fail(`${file}: JavaScript syntax check failed\n${String(error.stderr || error.message).trim()}`);
  }
}

note(`checked ${htmlFiles.length} HTML files`);
note("checked local href/src references");
note("checked visible-page aria-current nav state");
note("checked homepage puzzle contract");
note("checked cleanup invariants for stale canvas, debug shortcuts, and agent lockfile");
note("checked puzzle.js and pretext.js syntax");

if (errors.length) {
  console.error("Site check failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Site check passed:");
for (const item of notes) console.log(`- ${item}`);
