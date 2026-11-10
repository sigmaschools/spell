// Copyright 2026 Sigma
// SPDX-License-Identifier: Apache-2.0

// compass-app.js: the Compass app kit for the browser (app contract 1.0).
//
// Optional. An app can write its reports by hand; this file only makes them
// hard to get wrong. No dependencies, no network, no storage, nothing to set
// up: include it with a <script> tag and call CompassApp.launch().
//
//   const compass = CompassApp.launch();
//   compass.parts            // ["addition", "division"], or null: run your usual flow
//   compass.state            // the record you last saved for this learner, or null
//   compass.today            // the learner's day, "YYYY-MM-DD"
//   compass.finishPart({ part: "addition", correct: 9, wrong: 1, seconds: 64, items: [...] });
//   compass.saveState(record, { addition: "2026-11-14" });
//
// Everything is written into the page as
// <script type="application/json" data-compass-report> blocks, which Compass
// reads. Outside Compass (opened directly in a browser) everything still
// works: launch() returns no parts, no state and the device's own date, and
// reports are written as usual, so the app behaves the same everywhere.
//
// Full guide: compass/docs/apps/ in the Compass repository.

(function (global) {
  "use strict";

  var CONTRACT = "1";
  var STATE_MAX = 8000;

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /** A local date as YYYY-MM-DD. */
  function isoDay(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  /** The day `days` after a YYYY-MM-DD day (negative goes back). */
  function addDays(day, days) {
    var p = day.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days);
    return isoDay(d);
  }

  /** Whole days from one YYYY-MM-DD day to another. */
  function daysBetween(from, to) {
    var a = from.split("-");
    var b = to.split("-");
    var ms = Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2]);
    return Math.round(ms / 86400000);
  }

  function problem(message) {
    var err = new Error("compass-app: " + message);
    // A broken report is a bug in the app: say so loudly while developing,
    // and never stop a learner's activity over it.
    if (global.console && global.console.error) {
      global.console.error(err.message);
    }
    return err;
  }

  function writeBlock(report, replaceKind) {
    var doc = global.document;
    if (!doc || !doc.body) {
      throw problem("call report functions after the page has a <body>");
    }
    if (replaceKind) {
      var old = doc.querySelectorAll('script[data-compass-report][data-compass-kind="' + replaceKind + '"]');
      for (var i = 0; i < old.length; i++) {
        old[i].parentNode.removeChild(old[i]);
      }
    }
    var block = doc.createElement("script");
    block.type = "application/json";
    block.setAttribute("data-compass-report", "");
    block.setAttribute("data-compass-kind", report.kind);
    // "<" is escaped so text such as "</script>" in a prompt cannot end the block.
    block.textContent = JSON.stringify(report).replace(/</g, "\\u003c");
    doc.body.appendChild(block);
    return report;
  }

  function isCount(v) {
    return typeof v === "number" && v >= 0 && Math.floor(v) === v;
  }

  function launch(options) {
    var href = (options && options.url) || (global.location ? global.location.href : "");
    var params = new URL(href, "http://localhost/").searchParams;
    var contract = params.get("compass_contract");
    var partsParam = params.get("compass_parts");
    var today = params.get("compass_today");
    var appVersion = (options && options.appVersion) || undefined;

    if (contract !== null && contract !== CONTRACT) {
      problem("this page was launched under app contract " + contract + "; this kit follows " + CONTRACT);
    }
    if (today === null || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
      today = isoDay(new Date());
    }

    var finished = {};

    var app = {
      /** True when Compass launched this page. */
      inCompass: contract !== null,
      /** The app contract's major version Compass follows, or null outside Compass. */
      contract: contract,
      /** The parts to run, in order, or null for the app's usual flow. */
      parts: partsParam ? partsParam.split(",").filter(Boolean) : null,
      /** The record this app last saved for the learner, or null. */
      state: params.get("compass_state"),
      /** The learner's day as YYYY-MM-DD. */
      today: today,

      /**
       * One part finished: { part, title?, correct?, wrong?, seconds?, items? }.
       * Each item: { prompt, answer, correct, ms? }. Call it only when the
       * part is fully finished, never for a part stopped early.
       */
      finishPart: function (p) {
        if (!p || typeof p.part !== "string" || p.part === "") {
          throw problem("finishPart needs a part name");
        }
        if (finished[p.part]) {
          return null; // already reported in this visit
        }
        var report = { kind: "part", part: p.part, status: "finished" };
        if (p.title !== undefined) report.title = String(p.title);
        var items = p.items || null;
        var correct = p.correct;
        var wrong = p.wrong;
        if (items) {
          for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (!it || typeof it.prompt !== "string" || typeof it.correct !== "boolean") {
              throw problem("finishPart: item " + i + " needs a prompt (text) and correct (true or false)");
            }
          }
          if (correct === undefined) correct = items.filter(function (x) { return x.correct; }).length;
          if (wrong === undefined) wrong = items.length - correct;
          report.items = items;
        }
        if (correct !== undefined) {
          if (!isCount(correct)) throw problem("finishPart: correct must be a whole number, 0 or more");
          report.correct = correct;
        }
        if (wrong !== undefined) {
          if (!isCount(wrong)) throw problem("finishPart: wrong must be a whole number, 0 or more");
          report.wrong = wrong;
        }
        if (p.seconds !== undefined) {
          if (typeof p.seconds !== "number" || p.seconds < 0) throw problem("finishPart: seconds must be 0 or more");
          report.seconds = Math.round(p.seconds * 10) / 10;
        }
        if (appVersion) report.appVersion = appVersion;
        finished[p.part] = true;
        return writeBlock(report, null);
      },

      /**
       * Save this app's record for the learner (a string, at most 8,000
       * characters), and when each part is next needed: { part: "YYYY-MM-DD" }.
       * Compass hands the string back as `state` at the next launch. Save
       * whenever the record changes, at least when a part finishes.
       */
      saveState: function (data, due) {
        if (typeof data !== "string") {
          throw problem("saveState: the record must be a string (use JSON.stringify for an object)");
        }
        if (data.length > STATE_MAX) {
          throw problem("saveState: the record is " + data.length + " characters; the most is " + STATE_MAX);
        }
        var report = { kind: "state", data: data };
        if (due) {
          for (var k in due) {
            if (Object.prototype.hasOwnProperty.call(due, k) && !/^\d{4}-\d{2}-\d{2}$/.test(due[k])) {
              throw problem("saveState: due date for " + k + " must be YYYY-MM-DD");
            }
          }
          report.due = due;
        }
        if (appVersion) report.appVersion = appVersion;
        return writeBlock(report, "state");
      },

      /**
       * The learner's level in a subject: { subject?, scale: "lexile" | "course",
       * value, course?, setAt, history? }. Keep it on every signed-in screen.
       */
      reportLevel: function (l) {
        if (!l || (l.scale !== "lexile" && l.scale !== "course") || typeof l.value !== "number" || typeof l.setAt !== "string") {
          throw problem("reportLevel needs scale (lexile or course), a number value and setAt");
        }
        var report = { kind: "level", scale: l.scale, value: l.value, setAt: l.setAt, history: l.history || [] };
        if (l.subject) report.subject = l.subject;
        if (l.course) report.course = l.course;
        if (appVersion) report.appVersion = appVersion;
        return writeBlock(report, "level");
      },
    };
    return app;
  }

  global.CompassApp = {
    contract: CONTRACT,
    launch: launch,
    isoDay: isoDay,
    addDays: addDays,
    daysBetween: daysBetween,
  };
})(typeof window !== "undefined" ? window : globalThis);
