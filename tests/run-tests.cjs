"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const Audit = require(path.join(root, "audit-core.js"));
const Lottery = require(path.join(root, "lottery-core.js"));
const History = require(path.join(root, "history-core.js"));
const Reference = require(path.join(__dirname, "reference-v5.cjs"));

let checks = 0;

function check(value, message) {
  assert.ok(value, message);
  checks += 1;
}

function equal(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
  checks += 1;
}

function names(prefix, count) {
  return Array.from({ length: count }, function makeName(_value, index) { return prefix + (index + 1); });
}

function seedFor(index) {
  return crypto.createHash("sha256").update("paper-picker-v5-property-" + index).digest("hex");
}

function scheduleToPlan(schedule) {
  const indexes = new Map(schedule.students.map(function studentEntry(student, index) {
    return [student.id, index];
  }));
  return {
    weeks: schedule.weeks.map(function weekEntry(week, weekIndex) {
      return {
        weekIndex: weekIndex,
        assignments: week.assignments.map(function assignmentEntry(assignment, offset) {
          return {
            paperIndex: weekIndex * 3 + offset,
            studentIndexes: assignment.studentIds.map(function questioner(id) { return indexes.get(id); }),
            presenterIndex: indexes.get(assignment.presenterId),
          };
        }),
      };
    }),
  };
}

function assertPlanRules(plan, count) {
  const questions = new Array(count).fill(0);
  const presenters = new Array(count).fill(0);
  const papers = new Set();
  equal(plan.weeks.length, count / 3, "wrong week count");
  plan.weeks.forEach(function inspectWeek(week, weekIndex) {
    equal(week.weekIndex, weekIndex, "wrong week index");
    equal(week.assignments.length, 3, "wrong assignments per week");
    const weeklyQuestioners = [];
    week.assignments.forEach(function inspectAssignment(assignment, offset) {
      const paperIndex = weekIndex * 3 + offset;
      equal(assignment.paperIndex, paperIndex, "wrong paper index");
      check(!papers.has(paperIndex), "paper repeated");
      papers.add(paperIndex);
      equal(assignment.studentIndexes.length, 3, "wrong questioner count");
      equal(new Set(assignment.studentIndexes).size, 3, "questioner repeated within a paper");
      check(!assignment.studentIndexes.includes(assignment.presenterIndex),
        "presenter is also a questioner for the same paper");
      assignment.studentIndexes.forEach(function addQuestioner(index) {
        check(Number.isInteger(index) && index >= 0 && index < count, "questioner index out of range");
        questions[index] += 1;
        weeklyQuestioners.push(index);
      });
      check(Number.isInteger(assignment.presenterIndex) && assignment.presenterIndex >= 0 &&
        assignment.presenterIndex < count, "presenter index out of range");
      presenters[assignment.presenterIndex] += 1;
    });
    equal(new Set(weeklyQuestioners).size, 9, "weekly questioners are not unique");
  });
  equal(papers.size, count, "not every paper appears once");
  check(questions.every(function exactlyThree(value) { return value === 3; }),
    "not every student questions exactly three times");
  check(presenters.every(function exactlyOne(value) { return value === 1; }),
    "not every student presents exactly once");
}

function fixedV5Vector() {
  const students = names("学生", 9);
  const papers = names("论文", 9);
  const seed = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const issuedAt = "2026-01-02T03:04:05.678Z";
  const expectedPlan = {
    weeks: [
      { weekIndex: 0, assignments: [
        { paperIndex: 0, studentIndexes: [5, 4, 8], presenterIndex: 7 },
        { paperIndex: 1, studentIndexes: [6, 0, 3], presenterIndex: 2 },
        { paperIndex: 2, studentIndexes: [1, 7, 2], presenterIndex: 3 },
      ] },
      { weekIndex: 1, assignments: [
        { paperIndex: 3, studentIndexes: [1, 8, 7], presenterIndex: 5 },
        { paperIndex: 4, studentIndexes: [0, 4, 2], presenterIndex: 6 },
        { paperIndex: 5, studentIndexes: [3, 5, 6], presenterIndex: 0 },
      ] },
      { weekIndex: 2, assignments: [
        { paperIndex: 6, studentIndexes: [0, 4, 8], presenterIndex: 1 },
        { paperIndex: 7, studentIndexes: [5, 3, 2], presenterIndex: 8 },
        { paperIndex: 8, studentIndexes: [1, 7, 6], presenterIndex: 4 },
      ] },
    ],
  };

  const digest = Audit.inputDigest(students, papers);
  equal(digest, "78dd869a9a7877654d775ee55be603fd42fce918cc383b38ba2181c00da0e797",
    "v5 fixed input digest changed");
  equal(Audit.computeCommitment(students, papers, seed, issuedAt),
    "52cb054d505b1c4926234a0800f3027277bc5f5b3dc8b05ceae7064b9aa293ff",
    "v5 fixed commitment changed");
  equal(Audit.planDigest(expectedPlan, 9),
    "56c4c51452aacd566e6f8ba1f69db2046af9076aa1e9441826b970bc437ebc1a",
    "v5 fixed plan digest changed");
  const questionPrng = Audit.createPrng(seed, digest, "questions");
  const presenterPrng = Audit.createPrng(seed, digest, "presenters");
  equal(Array.from({ length: 4 }, function next() { return questionPrng.nextUint32(); }),
    [2057970536, 1889911843, 1050146633, 450919913], "v5 question stream changed");
  equal(Array.from({ length: 4 }, function next() { return presenterPrng.nextUint32(); }),
    [3865904066, 2807744475, 773126469, 2778001887], "v5 presenter stream changed");
  const schedule = Audit.createDeterministicSchedule(students, papers, seed, { createdAt: issuedAt });
  equal(scheduleToPlan(schedule), expectedPlan, "v5 fixed plan changed");
  equal(Reference.inputDigest(students, papers), digest, "reference v5 input digest differs");
  equal(Reference.commitment(students, papers, seed, issuedAt),
    Audit.computeCommitment(students, papers, seed, issuedAt), "reference v5 commitment differs");
  equal(Reference.makePlan(students, papers, seed), expectedPlan, "reference v5 plan differs");
  equal(Reference.planDigest(expectedPlan), Audit.planDigest(expectedPlan, 9),
    "reference v5 plan digest differs");
}

function normalizationChecks() {
  equal(Audit.parseTextLines("\u00a0Cafe\u0301\r\n　第二行　\r第三行\n\n"),
    ["Café", "第二行", "第三行"], "line normalization changed");
  assert.throws(function badSurrogate() { Audit.parseTextLines("坏\ud800字符"); },
    /代理|Unicode|字符/, "unpaired surrogate was not rejected");
  assert.throws(function normalizedDuplicate() {
    Audit.canonicalizeInput(
      ["Café", "Cafe\u0301"].concat(names("S", 7)),
      names("P", 9),
    );
  }, /相同|重复/, "duplicates created by NFC were not rejected");
  checks += 2;
}

function frozenV4Vector() {
  const students = names("学生", 12);
  const papers = names("论文", 12);
  const seed = "0".repeat(64);
  const issuedAt = "2026-09-09T00:00:00.000Z";
  const schedule = Audit.legacyV4.createAuditedSchedule(students, papers, {
    seedHex: seed,
    createdAt: issuedAt,
  });
  equal(schedule.audit.inputDigest,
    "c405489f4ec183129f2cde38e2807d80b59cf41631db27e152b0a565ea9e551b",
    "v4 fixed input digest changed");
  equal(schedule.audit.commitment,
    "a7742f176fd52f6fc25d27d43d551fe55b2f5001af489ea5882429fccde5f61b",
    "v4 fixed commitment changed");
  equal(schedule.audit.planDigest,
    "93f49494657ed4e2bd29578f96535488638f7b31df5dd98d5ee131ede04f1394",
    "v4 fixed plan digest changed");
  const receipt = Audit.createPublicReceipt(schedule);
  equal(receipt.version, 4, "public dispatcher did not preserve v4 receipt");
  Audit.confirmCommitment(schedule, "2026-09-09T00:01:00.000Z");
  schedule.weeks.forEach(function reveal(week) { week.revealed = [true, true, true]; });
  const report = Audit.createFinalReport(schedule, { completedAt: "2026-09-10T00:00:00.000Z" });
  check(Audit.verifyReceiptAndReport(receipt, report).ok, "public dispatcher cannot verify v4");
  const mismatched = structuredClone(report);
  mismatched.version = 5;
  equal(Audit.verifyReceiptAndReport(receipt, mismatched).code, "VERSION_MISMATCH",
    "mixed v4/v5 files were not rejected");
}

function v5EndToEndAndTampering() {
  const students = names("同学", 12);
  const papers = names("文献", 12);
  const schedule = Audit.createAuditedSchedule(students, papers, {
    seedHex: seedFor(50001),
    createdAt: "2026-09-09T01:00:00.000Z",
  });
  check(Lottery.verifySchedule(schedule), "LotteryCore rejects a valid v5 schedule");
  const receipt = Audit.createPublicReceipt(schedule);
  equal(receipt.version, 5, "new receipt is not v5");
  equal(receipt.presentersPerPaper, 1, "receipt does not commit to one presenter per paper");
  equal(receipt.finalPresentationsPerStudent, 1, "receipt does not commit to one presentation per student");
  check(!Object.hasOwn(receipt, "seed") && !Object.hasOwn(receipt, "plan") &&
    !Object.hasOwn(receipt, "students") && !Object.hasOwn(receipt, "papers"),
  "public receipt leaks private fields");
  check(!JSON.stringify(receipt).includes("同学1") && !JSON.stringify(receipt).includes("文献1"),
    "public receipt leaks input labels");

  Audit.confirmCommitment(schedule, "2026-09-09T01:01:00.000Z");
  schedule.weeks.forEach(function reveal(week) { week.revealed = [true, true, true]; });
  const report = Audit.createFinalReport(schedule, { completedAt: "2026-09-09T02:00:00.000Z" });
  const verified = Audit.verifyReceiptAndReport(receipt, report);
  check(verified.ok, "valid v5 audit does not verify");
  equal(verified.replayedPlan, report.plan, "verified replay differs from report");

  const alteredPresenter = structuredClone(report);
  alteredPresenter.plan.weeks[0].assignments[0].presenterIndex =
    alteredPresenter.plan.weeks[0].assignments[0].studentIndexes[0];
  check(!Audit.verifyReceiptAndReport(receipt, alteredPresenter).ok,
    "same-paper presenter/questioner tampering was accepted");
  const alteredDigest = structuredClone(report);
  alteredDigest.planDigest = (alteredDigest.planDigest[0] === "0" ? "1" : "0") + alteredDigest.planDigest.slice(1);
  equal(Audit.verifyReceiptAndReport(receipt, alteredDigest).code, "PLAN_DIGEST_MISMATCH",
    "tampered plan digest was not identified");
  const alteredReceipt = structuredClone(receipt);
  alteredReceipt.scheduleId = "changed";
  check(!Audit.verifyReceiptAndReport(alteredReceipt, report).ok, "altered receipt was accepted");

  const duplicatePresenter = structuredClone(schedule);
  duplicatePresenter.weeks[0].assignments[1].presenterId =
    duplicatePresenter.weeks[0].assignments[0].presenterId;
  check(!Lottery.verifySchedule(duplicatePresenter), "duplicate presenter was accepted");
  const overlap = structuredClone(schedule);
  overlap.weeks[0].assignments[0].presenterId = overlap.weeks[0].assignments[0].studentIds[0];
  check(!Lottery.verifySchedule(overlap), "same-paper role overlap was accepted");

  const historySchedule = structuredClone(schedule);
  historySchedule.weeks.forEach(function hide(week) { week.revealed = [false, false, false]; });
  historySchedule.weeks[0].revealed[0] = true;
  const rows = History.getVisibleRows(historySchedule);
  equal(rows.length, 1, "history did not follow reveal state");
  equal(rows[0].presenter,
    historySchedule.students.find(function findStudent(student) {
      return student.id === historySchedule.weeks[0].assignments[0].presenterId;
    }).name,
    "history omitted presenter");
  equal(Object.values(Lottery.countRevealedPresentations(historySchedule)).reduce(function sum(total, value) {
    return total + value;
  }, 0), 1, "presentation statistics are wrong");
  const changedPlan = structuredClone(historySchedule);
  const firstPresenter = changedPlan.weeks[0].assignments[0].presenterId;
  changedPlan.weeks[0].assignments[0].presenterId = changedPlan.weeks[0].assignments[1].presenterId;
  changedPlan.weeks[0].assignments[1].presenterId = firstPresenter;
  check(!History.sameSchedulePlan(historySchedule, changedPlan),
    "history signature ignores presenter assignments");
}

function propertyAndReferenceChecks() {
  const sizes = [9, 12, 15, 18, 24, 30];
  const cachedInputs = new Map(sizes.map(function inputForSize(count) {
    return [count, { students: names("S" + count + "-", count), papers: names("P" + count + "-", count) }];
  }));
  const total = 10000;
  const referenceComparisons = 2000;
  for (let index = 0; index < total; index += 1) {
    const count = sizes[index % sizes.length];
    const input = cachedInputs.get(count);
    const seed = seedFor(index);
    const schedule = Audit.createDeterministicSchedule(input.students, input.papers, seed);
    const plan = scheduleToPlan(schedule);
    assertPlanRules(plan, count);
    if (index < referenceComparisons) {
      equal(plan, Reference.makePlan(input.students, input.papers, seed),
        "production/reference plan mismatch at property seed " + index);
      equal(Audit.inputDigest(input.students, input.papers), Reference.inputDigest(input.students, input.papers),
        "production/reference input digest mismatch at property seed " + index);
      equal(Audit.planDigest(plan, count), Reference.planDigest(plan),
        "production/reference plan digest mismatch at property seed " + index);
    }
  }
}

function largeScheduleSmokeCheck() {
  const count = 9999;
  const students = names("L-S", count);
  const papers = names("L-P", count);
  const schedule = Audit.createDeterministicSchedule(students, papers, seedFor(99999));
  const plan = scheduleToPlan(schedule);
  assertPlanRules(plan, count);
}

function staticSiteChecks() {
  const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const verifyHtml = fs.readFileSync(path.join(root, "verify.html"), "utf8");
  const algorithmHtml = fs.readFileSync(path.join(root, "algorithm.html"), "utf8");
  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const verifyJs = fs.readFileSync(path.join(root, "verify.js"), "utf8");
  const allJavaScript = fs.readdirSync(root).filter(function jsFile(file) { return file.endsWith(".js"); })
    .map(function read(file) { return fs.readFileSync(path.join(root, file), "utf8"); }).join("\n");
  check(!/Math\.random\s*\(/.test(allJavaScript), "site contains Math.random fallback");
  check(fs.existsSync(path.join(root, "ALGORITHM-v4.md")), "frozen v4 specification is missing");
  check(indexHtml.includes("同篇论文两种角色不重复"), "homepage role rule is missing");
  check(indexHtml.includes("报告人可以在其他论文中担任提问人"), "homepage cross-paper role explanation is missing");
  check(!/[?&]v=4(?:[\"'])/.test(indexHtml + verifyHtml + algorithmHtml), "HTML still loads v4 assets");

  function assertIdsExist(source, html, label) {
    const ids = Array.from(source.matchAll(/(?:querySelector\(\s*["']#|getElementById\(\s*["'])([A-Za-z0-9_-]+)/g),
      function idMatch(match) { return match[1]; });
    ids.forEach(function idExists(id) {
      check(new RegExp("\\bid=[\\\"']" + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\\"']").test(html),
        label + " references missing #" + id);
    });
  }
  assertIdsExist(appJs, indexHtml, "app.js");
  assertIdsExist(verifyJs, verifyHtml, "verify.js");

  [indexHtml, verifyHtml, algorithmHtml].forEach(function localAssets(html) {
    for (const match of html.matchAll(/(?:src|href)=["']([^"'#?]+)(?:\?[^"']*)?["']/g)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|data:)/.test(target) || target.endsWith(".html")) continue;
      check(fs.existsSync(path.join(root, target)), "missing local asset " + target);
    }
  });
}

const startedAt = Date.now();
fixedV5Vector();
normalizationChecks();
frozenV4Vector();
v5EndToEndAndTampering();
propertyAndReferenceChecks();
largeScheduleSmokeCheck();
staticSiteChecks();
console.log("PASS " + checks + " assertions in " + ((Date.now() - startedAt) / 1000).toFixed(2) + "s");
