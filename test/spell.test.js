// Copyright 2026 Sigma. SPDX-License-Identifier: Apache-2.0
// Run with: node --test test/
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ctx = vm.createContext({});
for (const f of ["compass-app.js", "words.js", "spell.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f });
}
const { Spell, SPELL_GROUPS } = vm.runInContext("({ Spell, SPELL_GROUPS })", ctx);
const B = Spell.bank(SPELL_GROUPS);
// Values made in the test context compare as plain JSON.
const plain = (x) => JSON.parse(JSON.stringify(x));

test("every word's sentence uses the word, and words are unique", () => {
  const seen = new Set();
  for (const w of Object.values(B.words)) {
    assert.ok(w.sentence.toLowerCase().includes(w.word.toLowerCase()), `${w.word}: ${w.sentence}`);
    assert.ok(w.parts.some((p) => p.mark), `${w.word} has no marked letters`);
    assert.ok(!seen.has(w.word), `${w.word} twice`);
    seen.add(w.word);
  }
});

test("a new learner gets a placement set, one word per group", () => {
  const p = Spell.plan(null, B, "2026-11-10");
  assert.equal(p.placement, true);
  assert.equal(p.steps.length, SPELL_GROUPS.length);
});

test("an unreadable record is a new learner", () => {
  assert.equal(Spell.readRecord("not json"), null);
  assert.equal(Spell.readRecord('{"v":2}'), null);
});

test("placement: a right probe schedules its group's words as later reviews", () => {
  const rec = { v: 1, w: {} };
  Spell.score(rec, B, { kind: "probe", key: "ai.2" }, true, "2026-11-10");
  Spell.score(rec, B, { kind: "probe", key: "ee.2" }, false, "2026-11-10");
  assert.equal(Object.keys(rec.w).filter((k) => k.startsWith("ai.")).length, 8);
  const today = Spell.dayNum("2026-11-10");
  for (const k of Object.keys(rec.w).filter((k) => k.startsWith("ai."))) assert.ok(rec.w[k][1] > today);
  assert.deepEqual(plain(rec.w["ee.2"]), [0, today + 1]);
});

test("the day after placement: new words from the missed group, taught then tested", () => {
  const rec = { v: 1, w: {} };
  Spell.score(rec, B, { kind: "probe", key: "ai.2" }, true, "2026-11-10");
  Spell.score(rec, B, { kind: "probe", key: "ee.2" }, false, "2026-11-10");
  const p = Spell.plan(rec, B, "2026-11-11");
  const learn = p.steps.filter((s) => s.kind === "learn").map((s) => s.key);
  assert.deepEqual(plain(learn), ["ee.0", "ee.1", "ee.3", "ee.4", "ee.5"]);
  for (const k of learn) {
    const li = p.steps.findIndex((s) => s.kind === "learn" && s.key === k);
    const ti = p.steps.findIndex((s) => s.kind === "test" && s.key === k);
    assert.ok(ti - li > Spell.RETEST_GAP, `${k} tested too soon after teaching`);
  }
  assert.ok(p.steps.some((s) => s.kind === "review" && s.key === "ee.2"));
});

test("a word is learned after being right on three separate later days", () => {
  const rec = { v: 1, w: {} };
  let day = "2026-11-10";
  Spell.score(rec, B, { kind: "test", key: "ai.0" }, true, day); // taught today: not a day
  assert.equal(rec.w["ai.0"][0], 0);
  for (let i = 0; i < 3; i++) {
    day = ctx.CompassApp.addDays("2026-01-01", rec.w["ai.0"][1]);
    Spell.score(rec, B, { kind: "review", key: "ai.0" }, true, day);
  }
  assert.equal(rec.w["ai.0"][0], 3);
  assert.equal(Spell.learnedCount(rec), 1);
  // A miss starts it over, due tomorrow.
  Spell.score(rec, B, { kind: "review", key: "ai.0" }, false, day);
  assert.deepEqual(plain(rec.w["ai.0"]), [0, Spell.dayNum(day) + 1]);
});

test("look-alike groups are never new together", () => {
  // -tion is started but not settled: -sion waits, the next group starts.
  const rec = { v: 1, w: {} };
  for (const g of SPELL_GROUPS) {
    if (g.id === "tion") break;
    g.words.forEach((_, i) => (rec.w[`${g.id}.${i}`] = [3, 9999]));
  }
  SPELL_GROUPS.find((g) => g.id === "tion").words.forEach((_, i) => (rec.w[`tion.${i}`] = [0, 9999]));
  const p = Spell.plan(rec, B, "2026-11-10");
  const groups = new Set(p.steps.filter((s) => s.kind === "learn").map((s) => B.words[s.key].group));
  assert.deepEqual([...groups], ["ough"]);
});

test("reviews are capped so a set always has room to teach", () => {
  const rec = { v: 1, w: {} };
  for (const g of SPELL_GROUPS.slice(0, 4)) g.words.forEach((_, i) => (rec.w[`${g.id}.${i}`] = [1, 0]));
  const p = Spell.plan(rec, B, "2026-11-10");
  assert.equal(p.steps.filter((s) => s.kind === "review").length, 10);
  assert.equal(p.steps.filter((s) => s.kind === "learn").length, 2);
  assert.equal(p.steps.length, 14);
});

test("the record stays well under Compass's 8,000-character limit", () => {
  const rec = { v: 1, w: {} };
  for (const k of Object.keys(B.words)) rec.w[k] = [4, 400];
  assert.ok(JSON.stringify(rec).length < 4000, String(JSON.stringify(rec).length));
});

test("answers ignore case, outer spaces and curly apostrophes", () => {
  assert.ok(Spell.same(" Rain ", "rain"));
  assert.ok(!Spell.same("rane", "rain"));
});

test("placement: only the probed word counts as a right day; the rest are untested", () => {
  const rec = { v: 1, w: {} };
  Spell.score(rec, B, { kind: "probe", key: "ai.2" }, true, "2026-11-10");
  assert.equal(rec.w["ai.2"][0], 1);
  for (const i of [0, 1, 3, 4, 5, 6, 7]) assert.equal(rec.w[`ai.${i}`][0], 0);
});

test("look-alike groups stay apart even when placement touched both", () => {
  // Missed probes open dbl and drop; drop must still wait for dbl.
  const rec = { v: 1, w: {} };
  for (const g of ["ai", "ee", "igh"]) SPELL_GROUPS.find((x) => x.id === g).words.forEach((_, i) => (rec.w[`${g}.${i}`] = [3, 9999]));
  Spell.score(rec, B, { kind: "probe", key: "dbl.2" }, false, "2026-11-10");
  Spell.score(rec, B, { kind: "probe", key: "drop.2" }, false, "2026-11-10");
  const p = Spell.plan(rec, B, "2026-11-11");
  const groups = new Set(p.steps.filter((s) => s.kind === "learn").map((s) => B.words[s.key].group));
  assert.ok(!groups.has("drop"), [...groups].join(","));
  assert.ok(groups.has("dbl"));
});
