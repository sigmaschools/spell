// Copyright 2026 Sigma. SPDX-License-Identifier: Apache-2.0
//
// Spell's learning logic, kept apart from the page so it can be tested on
// its own. Nothing here touches the page, speech or Compass.
//
// The record (what Compass keeps for each learner) is compact JSON:
//   { "v": 1, "w": { "<group>.<index>": [streak, dueDay], ... } }
// streak counts the separate later days the word was spelled right in a
// row; dueDay is the day it is next tested, counted from 1 Jan 2026. A word
// is learned when its streak reaches 3: right on three separate days after
// the day it was taught.
"use strict";

(function (root) {
  const EPOCH = "2026-01-01";
  // Days until the next test, by streak: tomorrow after teaching or a miss,
  // then 3, 7, 21 and 60 days.
  const INTERVALS = [1, 3, 7, 21, 60];
  const LEARNED = 3;
  const SET_SIZE = 12; // words tested in a set, at most
  const MAX_REVIEWS = 10; // so a set always has room for new words
  const MAX_NEW = 5; // new words taught in one set
  const PROBE = 2; // placement tests each group's third word
  const PROBE_MISSES = 3; // placement stops after this many misses
  const RETEST_GAP = 3; // other steps between a correction and its retest

  function dayNum(iso) {
    return CompassApp.daysBetween(EPOCH, iso);
  }
  function isoOf(n) {
    return CompassApp.addDays(EPOCH, n);
  }

  // A word as written in the bank, "r[ai]n", to its spelling and marks.
  function parseWord(written) {
    const parts = [];
    const re = /\[([^\]]+)\]|([^[]+)/g;
    let m;
    while ((m = re.exec(written))) {
      if (m[1]) parts.push({ text: m[1], mark: true });
      else parts.push({ text: m[2], mark: false });
    }
    return { word: parts.map((p) => p.text).join(""), parts };
  }

  function bank(groups) {
    const words = {};
    for (const g of groups) {
      g.words.forEach(([written, sentence], i) => {
        const key = `${g.id}.${i}`;
        words[key] = { key, group: g.id, index: i, sentence, ...parseWord(written) };
      });
    }
    return { groups, words };
  }

  // The record from compass_state; anything unreadable is a new learner.
  function readRecord(data) {
    if (!data) return null;
    try {
      const r = JSON.parse(data);
      if (r && r.v === 1 && r.w && typeof r.w === "object") return r;
    } catch (_) {
      /* a new learner */
    }
    return null;
  }

  function settled(record, b, groupId) {
    const g = b.groups.find((x) => x.id === groupId);
    return g.words.every((_, i) => {
      const w = record.w[`${groupId}.${i}`];
      return w && w[0] >= 1;
    });
  }

  // The new words to teach next: carry on with groups already started, in
  // teaching order, then start the next group. A group with "apart" waits
  // until the group it is easily confused with is settled (every word right
  // on at least one later day), so the two are never new together.
  function nextNew(record, b, count) {
    const out = [];
    for (const g of b.groups) {
      if (out.length >= count) break;
      // A look-alike group waits even when placement already touched it.
      if (g.apart && !settled(record, b, g.apart)) continue;
      const started = g.words.some((_, i) => record.w[`${g.id}.${i}`]);
      for (let i = 0; i < g.words.length && out.length < count; i++) {
        if (!record.w[`${g.id}.${i}`]) out.push(`${g.id}.${i}`);
      }
      // Start at most one new group a day.
      if (!started && out.length) break;
    }
    return out;
  }

  // Mix review words so neighbours come from different groups where they
  // can: retrieval that has to pick the pattern, not repeat it.
  function interleave(keys, b) {
    const byGroup = new Map();
    for (const k of keys) {
      const g = b.words[k].group;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(k);
    }
    const out = [];
    const lists = [...byGroup.values()];
    while (out.length < keys.length) {
      for (const l of lists) if (l.length) out.push(l.shift());
    }
    return out;
  }

  // Today's set: the steps to run, in order. A step is
  //   { kind: "probe" | "review" | "learn" | "test", key }
  // "learn" shows a new word to copy; its "test" from memory comes later.
  function plan(record, b, today) {
    if (!record) {
      return {
        placement: true,
        steps: b.groups.map((g) => ({ kind: "probe", key: `${g.id}.${PROBE}` })),
      };
    }
    const t = dayNum(today);
    const due = Object.keys(record.w)
      .filter((k) => b.words[k] && record.w[k][1] <= t)
      .sort((a, c) => record.w[a][1] - record.w[c][1]);
    const reviews = interleave(due.slice(0, MAX_REVIEWS), b);
    const fresh = nextNew(record, b, Math.min(MAX_NEW, SET_SIZE - reviews.length));
    // A couple of reviews first, then each new word taught between reviews,
    // then each tested in the same order between more reviews. Every new
    // word's test comes at least as many steps after its teaching as there
    // are new words, so it is from memory, not from the screen.
    const r = reviews.map((key) => ({ kind: "review", key }));
    const steps = r.splice(0, 2);
    for (const key of fresh) {
      steps.push({ kind: "learn", key });
      if (r.length) steps.push(r.shift());
    }
    for (const key of fresh) {
      steps.push({ kind: "test", key });
      if (r.length) steps.push(r.shift());
    }
    steps.push(...r);
    return { placement: false, steps };
  }

  // Records one scored answer: the first attempt at a word today.
  function score(record, b, step, correct, today) {
    const t = dayNum(today);
    const w = record.w[step.key] || [0, t];
    if (step.kind === "probe" && correct) {
      // Right on placement: the group is likely known. Its other words come
      // back as reviews spread over the next four weeks, untested so far
      // (streak 0), so knowing them is shown on later days, never assumed.
      const g = b.words[step.key].group;
      const gi = b.groups.findIndex((x) => x.id === g);
      b.groups[gi].words.forEach((_, i) => {
        record.w[`${g}.${i}`] = [0, t + 2 + (((gi * 8 + i) * 11) % 28)];
      });
      record.w[step.key] = [1, t + INTERVALS[1]];
      return;
    }
    if (step.kind === "test" || !correct) {
      // Taught today, or missed: test again tomorrow. Right straight after
      // teaching is working memory, so it doesn't count as a day.
      record.w[step.key] = [0, t + INTERVALS[0]];
      return;
    }
    const s = w[0] + 1;
    record.w[step.key] = [s, t + INTERVALS[Math.min(s, INTERVALS.length - 1)]];
  }

  // The day the next set is owed: tomorrow while there are words to teach,
  // otherwise the earliest review.
  function nextDue(record, b, today) {
    const t = dayNum(today);
    if (nextNew(record, b, 1).length) return isoOf(t + 1);
    let min = Infinity;
    for (const k of Object.keys(record.w)) min = Math.min(min, record.w[k][1]);
    return isoOf(Math.max(t + 1, min));
  }

  function learnedCount(record) {
    return Object.values(record.w).filter((w) => w[0] >= LEARNED).length;
  }

  // Compares an answer with the word: case, spaces at the ends and curly
  // apostrophes don't matter; every letter does.
  function same(answer, word) {
    const norm = (s) => s.trim().toLowerCase().replace(/[‘’]/g, "'");
    return norm(answer) === norm(word);
  }

  root.Spell = {
    bank,
    readRecord,
    plan,
    score,
    nextDue,
    learnedCount,
    same,
    parseWord,
    dayNum,
    LEARNED,
    PROBE_MISSES,
    RETEST_GAP,
  };
})(typeof window === "undefined" ? globalThis : window);
