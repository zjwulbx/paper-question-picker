"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const Audit = require(path.join(root, "audit-core.js"));
const AuditV6 = require(path.join(root, "audit-core-v6.js"));
const AuditV7 = require(path.join(root, "audit-core-v7.js"));
const Lottery = require(path.join(root, "lottery-core.js"));
const History = require(path.join(root, "history-core.js"));
const Course = require(path.join(root, "course-core.js"));
const Reference = require(path.join(__dirname, "reference-v5.cjs"));
const ReferenceV6 = require(path.join(__dirname, "reference-v6.cjs"));
const ReferenceV7 = require(path.join(__dirname, "reference-v7.cjs"));

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

function seedForV6(index) {
  return crypto.createHash("sha256").update("paper-picker-v6-property-" + index).digest("hex");
}

function seedForV7(index) {
  return crypto.createHash("sha256").update("paper-picker-v7-property-" + index).digest("hex");
}

const SYNTHETIC_V6_WEEK_SIZES = [4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 3];

function v6Fixture(weekSizes) {
  const sizes = weekSizes.slice();
  const count = sizes.reduce(function total(sum, value) { return sum + value; }, 0);
  const students = Array.from({ length: count }, function anonymousStudent(_value, index) {
    return "匿名学生" + String(index + 1).padStart(3, "0");
  });
  let paperNumber = 0;
  const courseWeeks = sizes.map(function makeWeek(size, weekIndex) {
    return {
      label: "第" + String(weekIndex + 1).padStart(2, "0") + "周",
      papers: Array.from({ length: size }, function makePaper() {
        paperNumber += 1;
        return "论文" + String(paperNumber).padStart(3, "0");
      }),
    };
  });
  return { students: students, courseWeeks: courseWeeks, weekSizes: sizes };
}

function scheduleToV6Plan(schedule) {
  const indexes = new Map(schedule.students.map(function studentEntry(student, index) {
    return [student.id, index];
  }));
  let paperCursor = 0;
  return {
    weeks: schedule.weeks.map(function weekEntry(week, weekIndex) {
      const planWeek = {
        weekIndex: weekIndex,
        assignments: week.assignments.map(function assignmentEntry(assignment, offset) {
          return {
            paperIndex: paperCursor + offset,
            studentIndexes: assignment.studentIds.map(function questioner(id) { return indexes.get(id); }),
            presenterIndex: indexes.get(assignment.presenterId),
          };
        }),
      };
      paperCursor += week.assignments.length;
      return planWeek;
    }),
  };
}

function assertV6PlanRules(plan, weekSizes) {
  const count = weekSizes.reduce(function total(sum, size) { return sum + size; }, 0);
  const questions = new Array(count).fill(0);
  const presentations = new Array(count).fill(0);
  let paperCursor = 0;
  equal(plan.weeks.length, weekSizes.length, "v6 wrong week count");
  plan.weeks.forEach(function inspectWeek(week, weekIndex) {
    const weekSize = weekSizes[weekIndex];
    equal(week.weekIndex, weekIndex, "v6 wrong week index");
    equal(week.assignments.length, weekSize, "v6 wrong assignments per week");
    const weeklyQuestioners = [];
    week.assignments.forEach(function inspectAssignment(assignment, offset) {
      equal(assignment.paperIndex, paperCursor + offset, "v6 wrong paper index");
      equal(assignment.studentIndexes.length, 3, "v6 wrong questioner count");
      equal(new Set(assignment.studentIndexes).size, 3, "v6 repeated same-paper questioner");
      check(!assignment.studentIndexes.includes(assignment.presenterIndex),
        "v6 presenter is a questioner on the same paper");
      assignment.studentIndexes.forEach(function addQuestion(index) {
        check(Number.isInteger(index) && index >= 0 && index < count, "v6 questioner index out of range");
        questions[index] += 1;
        weeklyQuestioners.push(index);
      });
      check(Number.isInteger(assignment.presenterIndex) && assignment.presenterIndex >= 0 &&
        assignment.presenterIndex < count, "v6 presenter index out of range");
      presentations[assignment.presenterIndex] += 1;
    });
    equal(new Set(weeklyQuestioners).size, weekSize * 3, "v6 weekly questioners are not unique");
    paperCursor += weekSize;

    const usedSlots = paperCursor * 3;
    const low = Math.floor(usedSlots / count);
    const highCount = usedSlots % count;
    check(questions.every(function balanced(value) { return value === low || value === low + 1; }),
      "v6 prefix question counts are not balanced");
    equal(questions.filter(function high(value) { return value === low + 1; }).length, highCount,
      "v6 prefix high-count population is wrong");
  });
  equal(paperCursor, count, "v6 papers are not covered exactly once");
  check(questions.every(function exactlyThree(value) { return value === 3; }),
    "v6 not every student questions exactly three times");
  check(presentations.every(function exactlyOnce(value) { return value === 1; }),
    "v6 not every student presents exactly once");
}

function assertV7PlanRules(plan, weekSizes) {
  const count = weekSizes.reduce(function total(sum, size) { return sum + size; }, 0);
  const questions = new Array(count).fill(0);
  const presentations = new Array(count).fill(0);
  let paperCursor = 0;
  equal(plan.weeks.length, weekSizes.length, "v7 wrong week count");
  plan.weeks.forEach(function inspectWeek(week, weekIndex) {
    const weekSize = weekSizes[weekIndex];
    equal(week.weekIndex, weekIndex, "v7 wrong week index");
    equal(week.assignments.length, weekSize, "v7 wrong assignments per week");
    const weeklyQuestioners = [];
    const weeklyPresenters = [];
    week.assignments.forEach(function inspectAssignment(assignment, offset) {
      equal(assignment.paperIndex, paperCursor + offset, "v7 wrong paper index");
      equal(assignment.studentIndexes.length, 3, "v7 wrong questioner count");
      equal(new Set(assignment.studentIndexes).size, 3, "v7 repeated same-paper questioner");
      assignment.studentIndexes.forEach(function addQuestion(index) {
        check(Number.isInteger(index) && index >= 0 && index < count, "v7 questioner index out of range");
        questions[index] += 1;
        weeklyQuestioners.push(index);
      });
      check(Number.isInteger(assignment.presenterIndex) && assignment.presenterIndex >= 0 &&
        assignment.presenterIndex < count, "v7 presenter index out of range");
      presentations[assignment.presenterIndex] += 1;
      weeklyPresenters.push(assignment.presenterIndex);
    });
    equal(new Set(weeklyQuestioners).size, weekSize * 3, "v7 weekly questioners are not unique");
    equal(new Set(weeklyPresenters).size, weekSize, "v7 weekly presenters are not unique");
    const questionerSet = new Set(weeklyQuestioners);
    check(weeklyPresenters.every(function noWeeklyOverlap(index) { return !questionerSet.has(index); }),
      "v7 presenter also questions in the same week");
    paperCursor += weekSize;
  });
  equal(paperCursor, count, "v7 papers are not covered exactly once");
  check(questions.every(function exactlyThree(value) { return value === 3; }),
    "v7 not every student questions exactly three times");
  check(presentations.every(function exactlyOnce(value) { return value === 1; }),
    "v7 not every student presents exactly once");
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

function fixedV6Vector() {
  const fixture = v6Fixture(SYNTHETIC_V6_WEEK_SIZES);
  const seed = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const issuedAt = "2026-09-09T00:00:00.000Z";
  const expectedInputDigest = "c165a249c1958ac1c4090ba51ce0450580770043ffc7b244d5b502688298a7f7";
  const expectedCommitment = "72c68bf7828b87d0c5496f055cb568f20c5ad321d3d957cb33c13f2b5b7aa925";
  const expectedPlanDigest = "3a57d448814144a6e29d005702e0ac40ee66e4f0b415233059c43600d4260eef";

  equal(AuditV6.inputDigest(fixture.students, fixture.courseWeeks), expectedInputDigest,
    "v6 fixed input digest changed");
  equal(AuditV6.computeCommitment(fixture.students, fixture.courseWeeks, seed, issuedAt), expectedCommitment,
    "v6 fixed commitment changed");
  equal(ReferenceV6.inputDigest(fixture.students, fixture.courseWeeks), expectedInputDigest,
    "reference v6 fixed input digest differs");
  equal(ReferenceV6.commitment(fixture.students, fixture.courseWeeks, seed, issuedAt), expectedCommitment,
    "reference v6 fixed commitment differs");

  const questionPrng = AuditV6.createPrng(seed, expectedInputDigest, "questions");
  const presenterPrng = AuditV6.createPrng(seed, expectedInputDigest, "presenters");
  equal(Array.from({ length: 4 }, function next() { return questionPrng.nextUint32(); }),
    [757285734, 3441923874, 3892782815, 3875097610], "v6 question stream changed");
  equal(Array.from({ length: 4 }, function next() { return presenterPrng.nextUint32(); }),
    [2817210796, 3416166768, 264532386, 2533968787], "v6 presenter stream changed");

  const schedule = AuditV6.createAuditedSchedule(fixture.students, fixture.courseWeeks, {
    seedHex: seed,
    createdAt: issuedAt,
  });
  const plan = scheduleToV6Plan(schedule);
  const referencePlan = ReferenceV6.makePlan(fixture.students, fixture.courseWeeks, seed);
  equal(plan, referencePlan, "v6 fixed production/reference plan mismatch");
  equal(AuditV6.planDigest(plan, fixture.courseWeeks, fixture.students.length), expectedPlanDigest,
    "v6 fixed plan digest changed");
  equal(ReferenceV6.planDigest(referencePlan), expectedPlanDigest,
    "reference v6 fixed plan digest differs");
  equal(plan.weeks[0], {
    weekIndex: 0,
    assignments: [
      { paperIndex: 0, studentIndexes: [9, 47, 39], presenterIndex: 15 },
      { paperIndex: 1, studentIndexes: [35, 1, 37], presenterIndex: 23 },
      { paperIndex: 2, studentIndexes: [26, 16, 27], presenterIndex: 1 },
      { paperIndex: 3, studentIndexes: [34, 4, 33], presenterIndex: 44 },
    ],
  }, "v6 fixed first week changed");
  equal(plan.weeks[12], {
    weekIndex: 12,
    assignments: [
      { paperIndex: 45, studentIndexes: [18, 29, 45], presenterIndex: 35 },
      { paperIndex: 46, studentIndexes: [40, 35, 16], presenterIndex: 36 },
      { paperIndex: 47, studentIndexes: [44, 17, 9], presenterIndex: 46 },
    ],
  }, "v6 fixed last week changed");
  assertV6PlanRules(plan, fixture.weekSizes);
}

function v6InputAndStructureChecks() {
  const fixture = v6Fixture(SYNTHETIC_V6_WEEK_SIZES);
  const normalized = AuditV6.canonicalizeInput(
    fixture.students.map(function padded(name) { return "\u3000" + name + "\u00a0"; }),
    fixture.courseWeeks.map(function paddedWeek(week) {
      return {
        label: " " + week.label + " ",
        papers: week.papers.map(function paddedPaper(paper) { return "\u3000" + paper + " "; }),
      };
    }),
  );
  equal(normalized, { students: fixture.students, courseWeeks: fixture.courseWeeks },
    "v6 input normalization changed");
  equal(AuditV6.canonicalInput(fixture.students, fixture.courseWeeks),
    ReferenceV6.canonicalInput(fixture.students, fixture.courseWeeks),
    "v6 canonical input differs from reference");

  const wrongWeekSize = structuredClone(fixture.courseWeeks);
  wrongWeekSize[0].papers.pop();
  wrongWeekSize[0].papers.pop();
  assert.throws(function invalidWeekSize() {
    AuditV6.canonicalizeInput(fixture.students, wrongWeekSize);
  }, /3 或 4|3 or 4/, "v6 accepted a two-paper week");

  const duplicateLabel = structuredClone(fixture.courseWeeks);
  duplicateLabel[1].label = duplicateLabel[0].label;
  assert.throws(function invalidDuplicateLabel() {
    AuditV6.canonicalizeInput(fixture.students, duplicateLabel);
  }, /相同|重复/, "v6 accepted duplicate week labels");

  const duplicatePaper = structuredClone(fixture.courseWeeks);
  duplicatePaper[1].papers[0] = duplicatePaper[0].papers[0];
  assert.throws(function invalidDuplicatePaper() {
    AuditV6.canonicalizeInput(fixture.students, duplicatePaper);
  }, /相同|重复/, "v6 accepted duplicate paper titles");

  const extraWeekField = structuredClone(fixture.courseWeeks);
  extraWeekField[0].unexpected = true;
  assert.throws(function invalidExtraField() {
    AuditV6.canonicalizeInput(fixture.students, extraWeekField);
  }, /字段/, "v6 accepted an unknown course-week field");

  const tooFewForFour = v6Fixture([4, 3, 3]);
  assert.throws(function invalidWeeklyCapacity() {
    AuditV6.canonicalizeInput(tooFewForFour.students, tooFewForFour.courseWeeks);
  }, /不足/, "v6 accepted fewer than twelve students for a four-paper week");

  const normalizedDuplicateStudents = fixture.students.slice();
  normalizedDuplicateStudents[1] = "Cafe\u0301";
  normalizedDuplicateStudents[0] = "Café";
  assert.throws(function invalidNormalizedStudentDuplicate() {
    AuditV6.canonicalizeInput(normalizedDuplicateStudents, fixture.courseWeeks);
  }, /相同|重复/, "v6 accepted NFC-equivalent student names");
  checks += 6;
}

function findSafePresenterSwap(plan) {
  const assignments = plan.weeks.flatMap(function flatten(week) { return week.assignments; });
  for (let left = 0; left < assignments.length; left += 1) {
    for (let right = left + 1; right < assignments.length; right += 1) {
      if (!assignments[left].studentIndexes.includes(assignments[right].presenterIndex) &&
          !assignments[right].studentIndexes.includes(assignments[left].presenterIndex)) {
        return [assignments[left], assignments[right]];
      }
    }
  }
  throw new Error("test fixture contains no safe presenter swap");
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).reverse().map(function reversedEntry(key) {
    return [key, reverseObjectKeys(value[key])];
  }));
}

function v6EndToEndAndTampering() {
  const fixture = v6Fixture(SYNTHETIC_V6_WEEK_SIZES);
  const seed = seedForV6(70001);
  const issuedAt = "2026-09-09T01:00:00.000Z";
  const schedule = AuditV6.createAuditedSchedule(fixture.students, fixture.courseWeeks, {
    seedHex: seed,
    createdAt: issuedAt,
  });
  check(Lottery.verifySchedule(schedule), "LotteryCore rejects a valid v6 schedule");
  equal(schedule.weeks.map(function size(week) { return week.assignments.length; }), SYNTHETIC_V6_WEEK_SIZES,
    "v6 schedule lost the variable week structure");
  schedule.weeks.forEach(function revealShape(week, index) {
    equal(week.label, fixture.courseWeeks[index].label, "v6 schedule lost a week label");
    equal(week.revealed, new Array(SYNTHETIC_V6_WEEK_SIZES[index]).fill(false),
      "v6 reveal vector does not follow week size");
  });

  const receipt = AuditV6.createPublicReceipt(schedule);
  equal(receipt.version, 6, "new v6 receipt has the wrong version");
  equal(receipt.weekCount, SYNTHETIC_V6_WEEK_SIZES.length, "v6 receipt has the wrong week count");
  equal(receipt.weekPaperCounts, SYNTHETIC_V6_WEEK_SIZES, "v6 receipt did not commit to week sizes");
  equal(receipt.paperCount, 48, "v6 receipt has the wrong paper count");
  equal(receipt.finalSelectionsPerStudent, 3, "v6 receipt has the wrong question total");
  equal(receipt.finalPresentationsPerStudent, 1, "v6 receipt has the wrong presentation total");
  check(!Object.hasOwn(receipt, "seed") && !Object.hasOwn(receipt, "plan") &&
    !Object.hasOwn(receipt, "students") && !Object.hasOwn(receipt, "courseWeeks"),
  "v6 public receipt leaks private fields");
  check(!JSON.stringify(receipt).includes("匿名学生") && !JSON.stringify(receipt).includes("论文001"),
    "v6 public receipt leaks private input labels");

  const replayAtAnotherTime = AuditV6.createAuditedSchedule(fixture.students, fixture.courseWeeks, {
    seedHex: seed,
    createdAt: "2026-09-09T01:30:00.000Z",
  });
  equal(scheduleToV6Plan(replayAtAnotherTime), scheduleToV6Plan(schedule),
    "v6 seed/input replay depends on creation time");
  equal(replayAtAnotherTime.audit.planDigest, schedule.audit.planDigest,
    "v6 plan digest depends on creation time");
  check(replayAtAnotherTime.audit.commitment !== schedule.audit.commitment,
    "v6 commitment does not bind its issuance time");

  const rearranged = v6Fixture([3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3]);
  check(AuditV6.inputDigest(rearranged.students, rearranged.courseWeeks) !== schedule.audit.inputDigest,
    "v6 input digest ignores the week grouping");
  check(AuditV6.computeCommitment(rearranged.students, rearranged.courseWeeks, seed, issuedAt) !==
    schedule.audit.commitment, "v6 commitment ignores the week grouping");

  AuditV6.confirmCommitment(schedule, "2026-09-09T01:01:00.000Z");
  schedule.weeks.forEach(function reveal(week) { week.revealed.fill(true); });
  const report = AuditV6.createFinalReport(schedule, { completedAt: "2026-09-09T02:00:00.000Z" });
  const verified = AuditV6.verifyReceiptAndReport(receipt, report);
  check(verified.ok, "valid v6 audit does not verify");
  equal(verified.replayedPlan, report.plan, "verified v6 replay differs from report");
  check(AuditV6.verifyFinalReport(report, receipt).ok, "v6 final-report compatibility API failed");

  const reorderedReceipt = reverseObjectKeys(receipt);
  const reorderedReport = reverseObjectKeys(report);
  check(AuditV6.verifyReceiptAndReport(reorderedReceipt, reorderedReport).ok,
    "v6 verification depends on JSON object key order");
  equal(AuditV6.planDigest(reorderedReport.plan, fixture.courseWeeks, fixture.students.length), report.planDigest,
    "v6 plan digest depends on JSON object key order");
  equal(ReferenceV6.planDigest(reorderedReport.plan), report.planDigest,
    "reference v6 plan digest depends on JSON object key order");

  const overlappingRole = structuredClone(report);
  overlappingRole.plan.weeks[0].assignments[0].presenterIndex =
    overlappingRole.plan.weeks[0].assignments[0].studentIndexes[0];
  check(!AuditV6.verifyReceiptAndReport(receipt, overlappingRole).ok,
    "v6 accepted a same-paper presenter/questioner overlap");

  const duplicatePresenter = structuredClone(schedule);
  const sourcePresenter = duplicatePresenter.weeks[0].assignments[0].presenterId;
  const duplicateTarget = duplicatePresenter.weeks.flatMap(function flatten(week) { return week.assignments; })
    .find(function safeTarget(assignment) {
      return assignment.presenterId !== sourcePresenter && !assignment.studentIds.includes(sourcePresenter);
    });
  check(Boolean(duplicateTarget), "v6 test fixture has no safe duplicate-presenter target");
  duplicateTarget.presenterId = sourcePresenter;
  check(!Lottery.verifySchedule(duplicatePresenter), "LotteryCore accepted a duplicate v6 presenter");

  const validPlanChange = structuredClone(report);
  const swapped = findSafePresenterSwap(validPlanChange.plan);
  const savedPresenter = swapped[0].presenterIndex;
  swapped[0].presenterIndex = swapped[1].presenterIndex;
  swapped[1].presenterIndex = savedPresenter;
  equal(AuditV6.verifyReceiptAndReport(receipt, validPlanChange).code, "PLAN_DIGEST_MISMATCH",
    "v6 did not identify a valid-but-altered presenter plan");

  const alteredDigest = structuredClone(report);
  alteredDigest.planDigest = (alteredDigest.planDigest[0] === "0" ? "1" : "0") + alteredDigest.planDigest.slice(1);
  equal(AuditV6.verifyReceiptAndReport(receipt, alteredDigest).code, "PLAN_DIGEST_MISMATCH",
    "v6 did not identify a tampered plan digest");

  const alteredSeed = structuredClone(report);
  alteredSeed.seed = (alteredSeed.seed[0] === "0" ? "1" : "0") + alteredSeed.seed.slice(1);
  equal(AuditV6.verifyReceiptAndReport(receipt, alteredSeed).code, "COMMITMENT_MISMATCH",
    "v6 did not identify a tampered seed");

  const alteredCourse = structuredClone(report);
  alteredCourse.courseWeeks[0].label += "（改）";
  equal(AuditV6.verifyReceiptAndReport(receipt, alteredCourse).code, "INPUT_DIGEST_MISMATCH",
    "v6 did not identify a tampered course table");

  const alteredReceipt = structuredClone(receipt);
  const finalIndex = alteredReceipt.weekPaperCounts.length - 1;
  const savedSize = alteredReceipt.weekPaperCounts[0];
  alteredReceipt.weekPaperCounts[0] = alteredReceipt.weekPaperCounts[finalIndex];
  alteredReceipt.weekPaperCounts[finalIndex] = savedSize;
  equal(AuditV6.verifyReceiptAndReport(alteredReceipt, report).code, "RECEIPT_MISMATCH",
    "v6 did not identify tampered committed week sizes");
}

function v6LegacyDispatcherCompatibility() {
  const seed = seedForV6(71001);
  const issuedAt = "2026-09-09T03:00:00.000Z";
  const confirmedAt = "2026-09-09T03:01:00.000Z";
  const completedAt = "2026-09-09T04:00:00.000Z";
  [
    { api: Audit, students: names("匿名V5-", 12), papers: names("旧论文V5-", 12), version: 5 },
    { api: Audit.legacyV4, students: names("匿名V4-", 12), papers: names("旧论文V4-", 12), version: 4 },
  ].forEach(function legacyRoundTrip(item) {
    const schedule = item.api.createAuditedSchedule(item.students, item.papers, {
      seedHex: seed,
      createdAt: issuedAt,
    });
    const receipt = AuditV6.createPublicReceipt(schedule);
    equal(receipt.version, item.version, "v6 dispatcher changed a legacy receipt version");
    AuditV6.confirmCommitment(schedule, confirmedAt);
    schedule.weeks.forEach(function reveal(week) { week.revealed.fill(true); });
    const report = AuditV6.createFinalReport(schedule, { completedAt: completedAt });
    check(AuditV6.verifyReceiptAndReport(receipt, report).ok,
      "v6 dispatcher cannot verify a legacy v" + item.version + " audit");
    equal(AuditV6.parsePublicReceipt(receipt).version, item.version,
      "v6 dispatcher cannot parse a legacy v" + item.version + " receipt");
    equal(AuditV6.parseFinalReport(report).version, item.version,
      "v6 dispatcher cannot parse a legacy v" + item.version + " report");
  });
}

function v6HistoryAndBackupRoundTrip() {
  const fixture = v6Fixture(SYNTHETIC_V6_WEEK_SIZES);
  const schedule = AuditV6.createAuditedSchedule(fixture.students, fixture.courseWeeks, {
    seedHex: seedForV6(72001),
    createdAt: "2026-09-09T05:00:00.000Z",
  });
  AuditV6.confirmCommitment(schedule, "2026-09-09T05:01:00.000Z");
  schedule.weeks[0].revealed[3] = true;
  schedule.weeks[12].revealed[2] = true;
  const snapshot = {
    studentText: fixture.students.join("\n"),
    paperText: Course.formatCourseTable(fixture.courseWeeks),
    schedule: schedule,
    activeWeek: 12,
  };
  const saved = History.upsertSession([], snapshot, {
    type: "reveal",
    description: "揭晓匿名测试论文",
    at: "2026-09-09T05:02:00.000Z",
  }, Lottery.verifySchedule, {
    now: "2026-09-09T05:02:00.000Z",
    random: function deterministicSessionId() { return 0.25; },
  });
  const current = Object.assign({}, snapshot, { sessionId: saved.sessionId });
  const backup = History.createBackup(current, saved.sessions, Lottery.verifySchedule,
    "2026-09-09T05:03:00.000Z");
  const restored = History.parseBackup(structuredClone(backup), Lottery.verifySchedule,
    "2026-09-09T05:04:00.000Z");
  equal(restored.current.schedule, schedule, "v6 backup did not restore current schedule exactly");
  equal(restored.current.activeWeek, 12, "v6 backup did not restore the active week");
  equal(restored.sessions.length, 1, "v6 backup did not restore its history session");
  equal(restored.sessions[0].schedule, schedule, "v6 backup history changed the schedule");
  equal(History.getVisibleRows(restored.current.schedule).length, 2,
    "v6 backup lost variable-week reveal progress");

  const legacyV2 = structuredClone(backup);
  legacyV2.version = 2;
  equal(History.parseBackup(legacyV2, Lottery.verifySchedule, "2026-09-09T05:04:00.000Z").sessions.length, 1,
    "current code cannot import a legacy v2 backup envelope");
  const legacyV1 = structuredClone(backup);
  legacyV1.version = 1;
  delete legacyV1.classification;
  equal(History.parseBackup(legacyV1, Lottery.verifySchedule, "2026-09-09T05:04:00.000Z").sessions.length, 1,
    "current code cannot import a legacy v1 backup envelope");
}

function v6PresenterAttemptBoundary() {
  const assignments = [0, 1, 2, 3].map(function forbidden(index) {
    return { studentIndexes: [index] };
  });
  const indexes = [0, 1, 2, 3];
  const rejected = [0, 1, 2, 3];
  const accepted = [1, 2, 3, 0];
  let calls = 0;
  const atBoundary = ReferenceV6.findPresenterMatching(assignments, indexes, function boundaryShuffle() {
    calls += 1;
    return calls === ReferenceV6.MAX_PRESENTER_ATTEMPTS ? accepted.slice() : rejected.slice();
  });
  equal(atBoundary.attempts, 4096, "reference v6 skipped the final allowed presenter attempt");
  equal(calls, 4096, "reference v6 did not make exactly 4096 presenter attempts");

  calls = 0;
  assert.throws(function allRejected() {
    ReferenceV6.findPresenterMatching(assignments, indexes, function rejectedShuffle() {
      calls += 1;
      return rejected.slice();
    });
  }, /4096/, "reference v6 did not fail after exhausting presenter attempts");
  equal(calls, 4096, "reference v6 exceeded or undershot the presenter retry limit");
  checks += 1;

  const source = fs.readFileSync(path.join(root, "audit-core-v6.js"), "utf8");
  check(/const MAX_PRESENTER_ATTEMPTS = 4096;/.test(source), "production v6 presenter retry limit changed");
  check(/attempt\s*=\s*0;\s*attempt\s*<\s*MAX_PRESENTER_ATTEMPTS;\s*attempt\s*\+=\s*1/.test(source),
    "production v6 presenter loop no longer executes exactly the configured attempts");
}

function v6PropertyAndReferenceChecks() {
  const configurations = [
    [3, 3, 3],
    [4, 4, 4],
    [4, 4, 4, 3],
    [4, 4, 4, 3, 3],
    [4, 4, 4, 4, 4, 4],
    [4, 4, 4, 4, 4, 4, 3, 3],
    SYNTHETIC_V6_WEEK_SIZES,
    new Array(75).fill(4),
  ];
  const fixtures = configurations.map(v6Fixture);
  const total = 512;
  let maximumPresenterAttempts = 0;
  let retryingCases = 0;
  for (let index = 0; index < total; index += 1) {
    const fixture = fixtures[index % fixtures.length];
    const seed = seedForV6(index);
    const productionSchedule = AuditV6.createDeterministicSchedule(fixture.students, fixture.courseWeeks, seed);
    const productionPlan = scheduleToV6Plan(productionSchedule);
    const reference = ReferenceV6.makePlanWithStats(fixture.students, fixture.courseWeeks, seed);
    assertV6PlanRules(productionPlan, fixture.weekSizes);
    equal(productionPlan, reference.plan, "v6 production/reference plan mismatch at property seed " + index);
    equal(AuditV6.planDigest(productionPlan, fixture.courseWeeks, fixture.students.length),
      ReferenceV6.planDigest(reference.plan), "v6 production/reference plan digest mismatch at property seed " + index);
    equal(AuditV6.inputDigest(fixture.students, fixture.courseWeeks),
      ReferenceV6.inputDigest(fixture.students, fixture.courseWeeks),
      "v6 production/reference input digest mismatch at property seed " + index);
    if (index < 64) {
      equal(scheduleToV6Plan(AuditV6.createDeterministicSchedule(fixture.students, fixture.courseWeeks, seed)),
        productionPlan, "v6 same seed/input did not replay at property seed " + index);
      equal(AuditV6.computeCommitment(fixture.students, fixture.courseWeeks, seed, "2026-09-09T06:00:00.000Z"),
        ReferenceV6.commitment(fixture.students, fixture.courseWeeks, seed, "2026-09-09T06:00:00.000Z"),
        "v6 production/reference commitment mismatch at property seed " + index);
    }
    maximumPresenterAttempts = Math.max(maximumPresenterAttempts, reference.presenterAttempts);
    if (reference.presenterAttempts > 1) retryingCases += 1;
  }
  check(retryingCases > 0, "v6 property sample never exercised presenter retries");
  check(maximumPresenterAttempts < ReferenceV6.MAX_PRESENTER_ATTEMPTS,
    "v6 property sample reached the presenter retry ceiling");
  return { maximumPresenterAttempts: maximumPresenterAttempts, retryingCases: retryingCases };
}

function fixedV7Vector() {
  const fixture = v6Fixture(SYNTHETIC_V6_WEEK_SIZES);
  const seed = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
  const issuedAt = "2026-09-09T00:00:00.000Z";
  const expectedInputDigest = "10f1a806165285b92019290da2ad3e8459d567e388fd3d1c4bed90ab933d1d26";
  const expectedCommitment = "acfbe4fba7064be559986725d0bb5acd7783b7b946cff22765ce7efa5f85fcea";
  const expectedPlanDigest = "58abe47843b89986fc79396cf801b94dd77364ce2531ba5ca3b219073abd5e2d";

  equal(AuditV7.inputDigest(fixture.students, fixture.courseWeeks), expectedInputDigest,
    "v7 fixed input digest changed");
  equal(AuditV7.computeCommitment(fixture.students, fixture.courseWeeks, seed, issuedAt), expectedCommitment,
    "v7 fixed commitment changed");
  equal(ReferenceV7.inputDigest(fixture.students, fixture.courseWeeks), expectedInputDigest,
    "reference v7 fixed input digest differs");
  equal(ReferenceV7.commitment(fixture.students, fixture.courseWeeks, seed, issuedAt), expectedCommitment,
    "reference v7 fixed commitment differs");

  const questionPrng = AuditV7.createPrng(seed, expectedInputDigest, "questions");
  const presenterPrng = AuditV7.createPrng(seed, expectedInputDigest, "presenters");
  equal(Array.from({ length: 4 }, function next() { return questionPrng.nextUint32(); }),
    [2549331025, 3584920455, 3848812323, 2569504242], "v7 question stream changed");
  equal(Array.from({ length: 4 }, function next() { return presenterPrng.nextUint32(); }),
    [4141092843, 1114241966, 367047659, 3766117314], "v7 presenter stream changed");
  const referenceQuestionPrng = ReferenceV7.createPrng(seed, expectedInputDigest, "questions");
  const referencePresenterPrng = ReferenceV7.createPrng(seed, expectedInputDigest, "presenters");
  equal(Array.from({ length: 4 }, function next() { return referenceQuestionPrng.nextUint32(); }),
    [2549331025, 3584920455, 3848812323, 2569504242], "reference v7 question stream differs");
  equal(Array.from({ length: 4 }, function next() { return referencePresenterPrng.nextUint32(); }),
    [4141092843, 1114241966, 367047659, 3766117314], "reference v7 presenter stream differs");

  const schedule = AuditV7.createAuditedSchedule(fixture.students, fixture.courseWeeks, {
    seedHex: seed,
    createdAt: issuedAt,
  });
  const plan = scheduleToV6Plan(schedule);
  const referencePlan = ReferenceV7.makePlan(fixture.students, fixture.courseWeeks, seed);
  equal(plan, referencePlan, "v7 fixed production/reference plan mismatch");
  equal(AuditV7.planDigest(plan, fixture.courseWeeks, fixture.students.length), expectedPlanDigest,
    "v7 fixed plan digest changed");
  equal(ReferenceV7.planDigest(referencePlan), expectedPlanDigest,
    "reference v7 fixed plan digest differs");
  equal(plan.weeks[0], {
    weekIndex: 0,
    assignments: [
      { paperIndex: 0, studentIndexes: [3, 26, 0], presenterIndex: 46 },
      { paperIndex: 1, studentIndexes: [24, 37, 2], presenterIndex: 36 },
      { paperIndex: 2, studentIndexes: [42, 18, 10], presenterIndex: 23 },
      { paperIndex: 3, studentIndexes: [9, 11, 19], presenterIndex: 45 },
    ],
  }, "v7 fixed first week changed");
  equal(plan.weeks[12], {
    weekIndex: 12,
    assignments: [
      { paperIndex: 45, studentIndexes: [36, 2, 24], presenterIndex: 43 },
      { paperIndex: 46, studentIndexes: [23, 10, 42], presenterIndex: 41 },
      { paperIndex: 47, studentIndexes: [45, 19, 9], presenterIndex: 27 },
    ],
  }, "v7 fixed last week changed");
  equal(schedule.audit.protocolId, "paper-question-picker/v7", "v7 fixed schedule has wrong protocol id");
  equal(schedule.audit.scheduleId, "variable-week-cyclic-weekly-disjoint-roles/v1",
    "v7 fixed schedule has wrong schedule id");
  assertV7PlanRules(plan, fixture.weekSizes);
}

function v7InputAndBoundaryChecks() {
  const acceptedTwelve = v6Fixture([3, 3, 3, 3]);
  const acceptedSixteen = v6Fixture([4, 4, 4, 4]);
  const acceptedVariable = v6Fixture([4, 3, 3, 3, 3]);
  [acceptedTwelve, acceptedSixteen, acceptedVariable].forEach(function accepted(fixture) {
    const canonical = AuditV7.canonicalizeInput(fixture.students, fixture.courseWeeks);
    equal(canonical, ReferenceV7.canonicalizeInput(fixture.students, fixture.courseWeeks),
      "v7 production/reference boundary normalization differs");
    assertV7PlanRules(
      scheduleToV6Plan(AuditV7.createDeterministicSchedule(fixture.students, fixture.courseWeeks, seedForV7(fixture.students.length))),
      fixture.weekSizes,
    );
  });

  const nineForThree = v6Fixture([3, 3, 3]);
  assert.throws(function rejectNineForThree() {
    AuditV7.canonicalizeInput(nineForThree.students, nineForThree.courseWeeks);
  }, /12|不足|互不重复/, "v7 accepted 9 students for a three-paper week");
  const twelveForFour = v6Fixture([4, 4, 4]);
  assert.throws(function rejectTwelveForFour() {
    AuditV7.canonicalizeInput(twelveForFour.students, twelveForFour.courseWeeks);
  }, /不足|互不重复/, "v7 accepted 12 students for a four-paper week");
  assert.throws(function referenceRejectsNineForThree() {
    ReferenceV7.canonicalizeInput(nineForThree.students, nineForThree.courseWeeks);
  }, /input size|not enough/, "reference v7 accepted 9 students for a three-paper week");
  assert.throws(function referenceRejectsTwelveForFour() {
    ReferenceV7.canonicalizeInput(twelveForFour.students, twelveForFour.courseWeeks);
  }, /not enough/, "reference v7 accepted 12 students for a four-paper week");
  assert.throws(function referenceRejectsBadSeed() {
    ReferenceV7.commitment(acceptedTwelve.students, acceptedTwelve.courseWeeks, "0".repeat(63),
      "2026-09-09T00:00:00.000Z");
  }, /seed/, "reference v7 accepted a malformed seed");
  assert.throws(function referenceRejectsBadTime() {
    ReferenceV7.commitment(acceptedTwelve.students, acceptedTwelve.courseWeeks, "0".repeat(64),
      "2026-09-09 00:00:00Z");
  }, /time/, "reference v7 accepted a non-canonical issued time");
  checks += 6;
}

function findWeeklyOverlapPresenterSwap(plan) {
  const allAssignments = plan.weeks.flatMap(function flatten(week) { return week.assignments; });
  for (const week of plan.weeks) {
    for (const target of week.assignments) {
      for (const other of week.assignments) {
        if (other === target) continue;
        for (const weeklyQuestioner of other.studentIndexes) {
          const source = allAssignments.find(function currentPresenter(assignment) {
            return assignment.presenterIndex === weeklyQuestioner;
          });
          if (source && source !== target && !source.studentIndexes.includes(target.presenterIndex)) {
            const savedPresenter = target.presenterIndex;
            target.presenterIndex = source.presenterIndex;
            source.presenterIndex = savedPresenter;
            return true;
          }
        }
      }
    }
  }
  return false;
}

function findWeeklyOverlapPresenterIdSwap(schedule) {
  const allAssignments = schedule.weeks.flatMap(function flatten(week) { return week.assignments; });
  for (const week of schedule.weeks) {
    for (const target of week.assignments) {
      for (const other of week.assignments) {
        if (other === target) continue;
        for (const weeklyQuestioner of other.studentIds) {
          const source = allAssignments.find(function currentPresenter(assignment) {
            return assignment.presenterId === weeklyQuestioner;
          });
          if (source && source !== target && !source.studentIds.includes(target.presenterId)) {
            const savedPresenter = target.presenterId;
            target.presenterId = source.presenterId;
            source.presenterId = savedPresenter;
            return true;
          }
        }
      }
    }
  }
  return false;
}

function v7EndToEndTamperingAndLegacyCompatibility() {
  const fixture = v6Fixture(SYNTHETIC_V6_WEEK_SIZES);
  const seed = seedForV7(70001);
  const issuedAt = "2026-09-09T07:00:00.000Z";
  const schedule = AuditV7.createAuditedSchedule(fixture.students, fixture.courseWeeks, {
    seedHex: seed,
    createdAt: issuedAt,
  });
  check(Lottery.verifySchedule(schedule), "LotteryCore rejects a valid v7 schedule");
  assertV7PlanRules(scheduleToV6Plan(schedule), fixture.weekSizes);

  const receipt = AuditV7.createPublicReceipt(schedule);
  equal(receipt.version, 7, "new v7 receipt has the wrong version");
  equal(receipt.weekPaperCounts, SYNTHETIC_V6_WEEK_SIZES, "v7 receipt lost the week structure");
  check(!Object.hasOwn(receipt, "seed") && !Object.hasOwn(receipt, "plan") &&
    !Object.hasOwn(receipt, "students") && !Object.hasOwn(receipt, "courseWeeks"),
  "v7 public receipt leaks private fields");

  const replayAtAnotherTime = AuditV7.createAuditedSchedule(fixture.students, fixture.courseWeeks, {
    seedHex: seed,
    createdAt: "2026-09-09T07:30:00.000Z",
  });
  equal(scheduleToV6Plan(replayAtAnotherTime), scheduleToV6Plan(schedule),
    "v7 seed/input replay depends on creation time");
  equal(replayAtAnotherTime.audit.planDigest, schedule.audit.planDigest,
    "v7 plan digest depends on creation time");
  check(replayAtAnotherTime.audit.commitment !== schedule.audit.commitment,
    "v7 commitment does not bind its issuance time");
  assert.throws(function incompleteReportIsRejected() {
    AuditV7.createFinalReport(schedule, { completedAt: "2026-09-09T08:00:00.000Z" });
  }, /全部论文|结束/, "v7 exported a final report before all papers were revealed");
  checks += 1;

  AuditV7.confirmCommitment(schedule, "2026-09-09T07:01:00.000Z");
  schedule.weeks.forEach(function reveal(week) { week.revealed.fill(true); });
  const report = AuditV7.createFinalReport(schedule, { completedAt: "2026-09-09T08:00:00.000Z" });
  const verified = AuditV7.verifyReceiptAndReport(receipt, report);
  check(verified.ok, "valid v7 audit does not verify");
  equal(verified.replayedPlan, report.plan, "verified v7 replay differs from report");
  check(AuditV7.verifyReceiptAndReport(reverseObjectKeys(receipt), reverseObjectKeys(report)).ok,
    "v7 verification depends on JSON object key order");

  const weeklyOverlap = structuredClone(report);
  check(findWeeklyOverlapPresenterSwap(weeklyOverlap.plan), "v7 test could not create a weekly-only role overlap");
  check(typeof AuditV6.planDigest(weeklyOverlap.plan, fixture.courseWeeks, fixture.students.length) === "string",
    "weekly-only overlap unexpectedly violates the frozen v6 structural rules");
  equal(AuditV7.verifyReceiptAndReport(receipt, weeklyOverlap).code, "INVALID_PLAN",
    "v7 accepted a presenter who questions another paper in the same week");

  const weeklyOverlapSchedule = structuredClone(schedule);
  check(findWeeklyOverlapPresenterIdSwap(weeklyOverlapSchedule),
    "v7 test could not create a weekly-only schedule overlap");
  check(!Lottery.verifySchedule(weeklyOverlapSchedule),
    "LotteryCore accepted a presenter who questions another paper in the same week");
  assert.throws(function rejectOverlappingBackup() {
    History.createBackup({
      studentText: fixture.students.join("\n"),
      paperText: Course.formatCourseTable(fixture.courseWeeks),
      schedule: weeklyOverlapSchedule,
      activeWeek: 0,
    }, [], Lottery.verifySchedule, "2026-09-09T08:30:00.000Z");
  }, /安排|进度|无效|invalid/i, "private backup accepted a v7 schedule with weekly role overlap");
  checks += 1;

  const unknownProtocol = structuredClone(schedule);
  unknownProtocol.audit.protocolId = "paper-question-picker/unknown";
  check(!Lottery.verifySchedule(unknownProtocol), "LotteryCore accepted an unknown audited protocol");

  const alteredDigest = structuredClone(report);
  alteredDigest.planDigest = (alteredDigest.planDigest[0] === "0" ? "1" : "0") + alteredDigest.planDigest.slice(1);
  equal(AuditV7.verifyReceiptAndReport(receipt, alteredDigest).code, "PLAN_DIGEST_MISMATCH",
    "v7 did not identify a tampered plan digest");

  const alteredSeed = structuredClone(report);
  alteredSeed.seed = (alteredSeed.seed[0] === "0" ? "1" : "0") + alteredSeed.seed.slice(1);
  equal(AuditV7.verifyReceiptAndReport(receipt, alteredSeed).code, "COMMITMENT_MISMATCH",
    "v7 did not identify a tampered seed");

  const alteredCourse = structuredClone(report);
  alteredCourse.courseWeeks[0].label += "（改）";
  equal(AuditV7.verifyReceiptAndReport(receipt, alteredCourse).code, "INPUT_DIGEST_MISMATCH",
    "v7 did not identify a tampered course table");

  const wrongVersion = structuredClone(report);
  wrongVersion.version = 6;
  equal(AuditV7.verifyReceiptAndReport(receipt, wrongVersion).code, "VERSION_MISMATCH",
    "v7 accepted mixed v6/v7 evidence");

  const legacyV6Fixture = v6Fixture(SYNTHETIC_V6_WEEK_SIZES);
  const legacyV6Schedule = AuditV6.createAuditedSchedule(legacyV6Fixture.students, legacyV6Fixture.courseWeeks, {
    seedHex: seedForV6(77001),
    createdAt: "2026-09-09T09:00:00.000Z",
  });
  const legacyV6Receipt = AuditV6.createPublicReceipt(legacyV6Schedule);
  AuditV6.confirmCommitment(legacyV6Schedule, "2026-09-09T09:01:00.000Z");
  legacyV6Schedule.weeks.forEach(function reveal(week) { week.revealed.fill(true); });
  const legacyV6Report = AuditV6.createFinalReport(legacyV6Schedule, {
    completedAt: "2026-09-09T10:00:00.000Z",
  });
  check(AuditV7.verifyReceiptAndReport(legacyV6Receipt, legacyV6Report).ok,
    "v7 dispatcher cannot verify a frozen v6 audit");

  const historySchedule = AuditV7.createAuditedSchedule(fixture.students, fixture.courseWeeks, {
    seedHex: seedForV7(77500),
    createdAt: "2026-09-09T10:30:00.000Z",
  });
  AuditV7.confirmCommitment(historySchedule, "2026-09-09T10:31:00.000Z");
  historySchedule.weeks[0].revealed[0] = true;
  const historySnapshot = {
    studentText: fixture.students.join("\n"),
    paperText: Course.formatCourseTable(fixture.courseWeeks),
    schedule: historySchedule,
    activeWeek: 0,
  };
  const historyResult = History.upsertSession([], historySnapshot, {
    type: "reveal",
    description: "v7 历史往返测试",
    at: "2026-09-09T10:32:00.000Z",
  }, Lottery.verifySchedule, {
    now: "2026-09-09T10:32:00.000Z",
    random: function deterministicSessionId() { return 0.75; },
  });
  const historyCurrent = Object.assign({}, historySnapshot, { sessionId: historyResult.sessionId });
  const historyBackup = History.createBackup(historyCurrent, historyResult.sessions, Lottery.verifySchedule,
    "2026-09-09T10:33:00.000Z");
  const restoredHistory = History.parseBackup(structuredClone(historyBackup), Lottery.verifySchedule,
    "2026-09-09T10:34:00.000Z");
  equal(restoredHistory.current.schedule, historySchedule, "v7 private backup changed the current schedule");
  equal(restoredHistory.sessions.length, 1, "v7 private backup lost its history session");

  [
    { api: Audit, students: names("匿名V5兼容-", 12), papers: names("旧论文V5兼容-", 12), version: 5 },
    { api: Audit.legacyV4, students: names("匿名V4兼容-", 12), papers: names("旧论文V4兼容-", 12), version: 4 },
  ].forEach(function legacyRoundTrip(item) {
    const legacySchedule = item.api.createAuditedSchedule(item.students, item.papers, {
      seedHex: seedForV7(78000 + item.version),
      createdAt: "2026-09-09T11:00:00.000Z",
    });
    const legacyReceipt = item.api.createPublicReceipt(legacySchedule);
    item.api.confirmCommitment(legacySchedule, "2026-09-09T11:01:00.000Z");
    legacySchedule.weeks.forEach(function reveal(week) { week.revealed.fill(true); });
    const legacyReport = item.api.createFinalReport(legacySchedule, {
      completedAt: "2026-09-09T12:00:00.000Z",
    });
    equal(AuditV7.parsePublicReceipt(legacyReceipt).version, item.version,
      "v7 dispatcher changed a legacy receipt version");
    check(AuditV7.verifyReceiptAndReport(legacyReceipt, legacyReport).ok,
      "v7 dispatcher cannot verify a frozen v" + item.version + " audit");
  });
}

function v7PropertyAndReferenceChecks() {
  const configurations = [
    [3, 3, 3, 3],
    [4, 4, 4, 4],
    [4, 3, 3, 3, 3],
    [4, 4, 3, 3, 3],
    [4, 4, 4, 3, 3, 3],
    [4, 4, 4, 4, 3, 3, 3, 3],
    SYNTHETIC_V6_WEEK_SIZES,
    new Array(75).fill(4),
  ];
  const fixtures = configurations.map(v6Fixture);
  const total = 1024;
  for (let index = 0; index < total; index += 1) {
    const fixture = fixtures[index % fixtures.length];
    const seed = seedForV7(index);
    const productionSchedule = AuditV7.createDeterministicSchedule(fixture.students, fixture.courseWeeks, seed);
    const productionPlan = scheduleToV6Plan(productionSchedule);
    const referencePlan = ReferenceV7.makePlan(fixture.students, fixture.courseWeeks, seed);
    assertV7PlanRules(productionPlan, fixture.weekSizes);
    equal(productionPlan, referencePlan, "v7 production/reference plan mismatch at property seed " + index);
    equal(AuditV7.planDigest(productionPlan, fixture.courseWeeks, fixture.students.length),
      ReferenceV7.planDigest(referencePlan), "v7 production/reference plan digest mismatch at property seed " + index);
    equal(AuditV7.inputDigest(fixture.students, fixture.courseWeeks),
      ReferenceV7.inputDigest(fixture.students, fixture.courseWeeks),
      "v7 production/reference input digest mismatch at property seed " + index);
    if (index < 64) {
      equal(scheduleToV6Plan(AuditV7.createDeterministicSchedule(fixture.students, fixture.courseWeeks, seed)),
        productionPlan, "v7 same seed/input did not replay at property seed " + index);
      equal(AuditV7.computeCommitment(fixture.students, fixture.courseWeeks, seed, "2026-09-09T13:00:00.000Z"),
        ReferenceV7.commitment(fixture.students, fixture.courseWeeks, seed, "2026-09-09T13:00:00.000Z"),
        "v7 production/reference commitment mismatch at property seed " + index);
    }
  }
  const source = fs.readFileSync(path.join(root, "audit-core-v7.js"), "utf8");
  check(!/MAX_PRESENTER_ATTEMPTS/.test(source), "v7 unexpectedly contains presenter retry logic");
  check(/roleOrder\s*=\s*presenterRandom\.shuffle/.test(source) && /questionOffsets\s*=/.test(source),
    "v7 cyclic role construction is missing");
  return total;
}

function createAppBrowserVm(options) {
  const stored = new Map(Object.entries((options && options.storage) || {}));
  const timers = [];
  const elements = new Map();

  function fakeElement() {
    const listeners = new Map();
    return {
      value: "",
      textContent: "",
      innerHTML: "",
      hidden: false,
      disabled: false,
      className: "",
      dataset: {},
      style: {},
      files: [],
      addEventListener: function addEventListener(type, listener) {
        const current = listeners.get(type) || [];
        current.push(listener);
        listeners.set(type, current);
      },
      dispatch: function dispatch(type, event) {
        (listeners.get(type) || []).forEach(function invoke(listener) {
          listener(event || { target: this });
        }, this);
      },
      replaceChildren: function replaceChildren() {},
      scrollIntoView: function scrollIntoView() {},
      click: function click() {},
      closest: function closest() { return null; },
    };
  }

  const document = {
    querySelector: function querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, fakeElement());
      return elements.get(selector);
    },
    getElementById: function getElementById(id) {
      return this.querySelector("#" + id);
    },
    createElement: fakeElement,
  };

  const localStorage = {
    getItem: function getItem(key) {
      return stored.has(key) ? stored.get(key) : null;
    },
    setItem: function setItem(key, value) {
      stored.set(key, String(value));
    },
    removeItem: function removeItem(key) {
      stored.delete(key);
    },
  };

  const context = {
    console: console,
    document: document,
    localStorage: localStorage,
    navigator: {},
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    Uint8Array: Uint8Array,
    DataView: DataView,
    Blob: Blob,
    structuredClone: structuredClone,
    URL: {
      createObjectURL: function createObjectURL() { return "blob:test"; },
      revokeObjectURL: function revokeObjectURL() {},
    },
    crypto: {
      getRandomValues: function getRandomValues(array) {
        array.fill(7);
        return array;
      },
    },
  };

  context.window = context;
  context.globalThis = context;
  context.confirm = function confirm() { return true; };
  context.addEventListener = function addEventListener() {};
  context.setTimeout = function setTimeout(callback) {
    timers.push(callback);
    return timers.length;
  };
  context.clearTimeout = function clearTimeout() {};

  vm.createContext(context);
  function load(file) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  }
  ["course-core.js", "lottery-core.js", "history-core.js", "audit-core.js", "audit-core-v6.js"].forEach(load);
  if (!options || options.includeV7 !== false) load("audit-core-v7.js");
  load("app.js");

  return {
    context: context,
    elements: elements,
    storage: stored,
    flushTimers: function flushTimers() {
      let count = 0;
      while (timers.length) {
        timers.shift()();
        count += 1;
        if (count > 1000) throw new Error("browser VM timer loop did not settle");
      }
    },
  };
}

function browserWiringAndMigrationChecks() {
  const smallFixture = v6Fixture([3, 3, 3, 3]);
  const missingCoreBrowser = createAppBrowserVm({ includeV7: false });
  const missingStudents = missingCoreBrowser.elements.get("#students-input");
  const missingPapers = missingCoreBrowser.elements.get("#papers-input");
  const missingGenerate = missingCoreBrowser.elements.get("#generate-button");
  equal(missingCoreBrowser.context.AuditCore.PROTOCOL_ID, "paper-question-picker/v6",
    "missing-v7 browser fixture unexpectedly loaded v7");
  missingStudents.value = smallFixture.students.join("\n");
  missingPapers.value = Course.formatCourseTable(smallFixture.courseWeeks);
  missingStudents.dispatch("input");
  missingPapers.dispatch("input");
  missingCoreBrowser.flushTimers();
  if (!missingGenerate.disabled) missingGenerate.dispatch("click");
  missingCoreBrowser.flushTimers();
  const missingRaw = missingCoreBrowser.storage.get("paper-question-picker-web-v7");
  const missingSaved = missingRaw ? JSON.parse(missingRaw) : null;
  check(!missingSaved || missingSaved.schedule === null,
    "app generated an older-protocol schedule when the v7 core was unavailable");
  check(missingGenerate.disabled, "generate button stayed enabled without the v7 core");
  check(/v7|核心.*载入|刷新/.test(missingCoreBrowser.elements.get("#visible-status-text").textContent),
    "missing v7 core was not explained to the user");

  const fixture = v6Fixture(SYNTHETIC_V6_WEEK_SIZES);
  const oldSchedule = AuditV6.createAuditedSchedule(fixture.students, fixture.courseWeeks, {
    seedHex: seedForV6(88001),
    createdAt: "2026-09-09T00:00:00.000Z",
  });
  AuditV6.confirmCommitment(oldSchedule, "2026-09-09T00:01:00.000Z");
  oldSchedule.weeks[0].revealed[0] = true;
  const oldRaw = JSON.stringify({
    appVersion: 6,
    scheduleKind: "audited-v6",
    studentText: fixture.students.join("\n"),
    paperText: Course.formatCourseTable(fixture.courseWeeks),
    schedule: oldSchedule,
    activeWeek: 7,
    sessionId: null,
  });
  const migrationBrowser = createAppBrowserVm({
    includeV7: true,
    storage: { "paper-question-picker-web-v6": oldRaw },
  });
  migrationBrowser.flushTimers();
  const migrated = JSON.parse(migrationBrowser.storage.get("paper-question-picker-web-v7"));
  equal(migrated.appVersion, 7, "migration did not write a v7 envelope");
  equal(migrated.scheduleKind, "audited-v6", "migration relabeled a frozen v6 draw");
  equal(migrated.schedule.audit.protocolId, "paper-question-picker/v6", "migration rewrote the frozen protocol");
  equal(migrated.schedule, oldSchedule, "migration changed a frozen v6 schedule or its reveal state");
  equal(migrated.activeWeek, 7, "migration lost active-week progress");
  equal(migrationBrowser.storage.get("paper-question-picker-web-v6"), oldRaw,
    "migration destructively changed the old source value");
  const migratedHistory = JSON.parse(migrationBrowser.storage.get("paper-question-picker-history-v7"));
  check(migratedHistory.sessions.some(function containsV6(session) {
    return session.schedule.audit.protocolId === "paper-question-picker/v6";
  }), "migration did not preserve v6 progress in v7 history");
  check(/旧版安排|原有抽签|不会被新规则改写/.test(
    migrationBrowser.elements.get("#visible-status-text").textContent,
  ), "migration did not disclose that the restored draw still uses v6 rules");
}

function privateInputDefaultsChecks() {
  check(!fs.existsSync(path.join(root, "course-preset.js")),
    "public source still ships a real course preset");
  const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const readmeSource = fs.readFileSync(path.join(root, "README.md"), "utf8");
  check(!/CoursePreset|DEFAULT_COURSE|courseButton|course-button|loadCoursePreset/.test(appSource + "\n" + indexSource),
    "public app still references a semester course preset");
  check(!/course-preset\.js|载入本学期论文/.test(indexSource),
    "public page still offers the private semester preset");
  check(/学生名单与论文安排只保存在当前浏览器/.test(indexSource),
    "page does not explain that both private inputs stay in the browser");
  check(/网站源代码不预置真实课程名单/.test(readmeSource),
    "README does not document the private-input default");
  check(/function loadState\(\)[\s\S]*?elements\.studentsInput\.value = "";\s*elements\.papersInput\.value = "";/.test(appSource),
    "fresh load does not explicitly blank both private inputs");
  check(/const paperText = typeof saved\.paperText === "string" \? saved\.paperText : "";/.test(appSource),
    "missing structured paperText can fall back to bundled course data");
}

function syntheticCourseTableChecks() {
  const table = [
    "周次/日期\t论文标题\t状态",
    "第一周\t合成论文 A\t",
    "\t合成论文 B\t正常",
    "\t合成论文 C\t有效",
    "\t合成论文 D\t取消",
    "第二周\t合成论文 E\t",
    "\t合成论文 F\t",
    "\t合成论文 G\t正常",
    "\t合成论文 H\t有效",
    "\t合成论文 I\t取消",
  ].join("\n");
  const parsed = Course.parseCourseTable(table);
  equal(parsed.errors, [], "synthetic course table contains parse errors");
  equal(parsed.weeks, [
    { label: "第一周", papers: ["合成论文 A", "合成论文 B", "合成论文 C"] },
    { label: "第二周", papers: ["合成论文 E", "合成论文 F", "合成论文 G", "合成论文 H"] },
  ], "course table did not preserve 3/4-paper week grouping and continuation rows");
  equal(parsed.activePapers.length, 7, "course table counted active rows incorrectly");
  equal(parsed.excludedRows.map(function paper(row) { return row.paper; }), ["合成论文 D", "合成论文 I"],
    "course table did not exclude cancelled rows");
  const activeOnly = Course.formatCourseTable(parsed.weeks);
  const reparsed = Course.parseCourseInput(activeOnly);
  equal(reparsed.errors, [], "formatted active-only course table did not parse");
  equal(reparsed.weeks, parsed.weeks, "formatted course table did not round-trip");
  equal(reparsed.excludedRows, [], "active-only round-trip retained cancelled rows");
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
  check(fs.existsSync(path.join(root, "ALGORITHM-v6.md")), "frozen v6 specification is missing");
  check(fs.existsSync(path.join(root, "audit-core-v7.js")), "v7 audit core is missing");
  check(indexHtml.includes("同周任务不叠加"), "homepage v7 rule summary is missing");
  check(indexHtml.includes("同一周不会同时承担报告和提问任务"),
    "homepage weekly role separation explanation is missing");
  check(indexHtml.includes('audit-core-v7.js?v=7'), "homepage does not load the v7 audit core");
  check(verifyHtml.includes('audit-core-v7.js?v=7'), "verifier does not load the v7 audit core");
  check(/paper-question-picker-web-v7/.test(appJs) && /appVersion:\s*7/.test(appJs),
    "app does not use the v7 storage envelope");
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

  const elementMap = appJs.match(/const elements = \{([\s\S]*?)\n  \};/);
  check(Boolean(elementMap), "app.js element map is missing");
  const declaredElements = new Set(Array.from(elementMap[1].matchAll(/^\s{4}([A-Za-z_$][\w$]*):/gm), function name(match) {
    return match[1];
  }));
  const usedElements = new Set(Array.from(appJs.matchAll(/\belements\.([A-Za-z_$][\w$]*)/g), function name(match) {
    return match[1];
  }));
  usedElements.forEach(function declared(name) {
    check(declaredElements.has(name), "app.js uses undeclared elements." + name);
  });

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
fixedV6Vector();
v6InputAndStructureChecks();
v6EndToEndAndTampering();
v6LegacyDispatcherCompatibility();
v6HistoryAndBackupRoundTrip();
v6PresenterAttemptBoundary();
const v6PropertyStats = v6PropertyAndReferenceChecks();
fixedV7Vector();
v7InputAndBoundaryChecks();
v7EndToEndTamperingAndLegacyCompatibility();
const v7PropertyCount = v7PropertyAndReferenceChecks();
browserWiringAndMigrationChecks();
privateInputDefaultsChecks();
syntheticCourseTableChecks();
propertyAndReferenceChecks();
largeScheduleSmokeCheck();
staticSiteChecks();
console.log("PASS " + checks + " assertions in " + ((Date.now() - startedAt) / 1000).toFixed(2) + "s");
console.log("v6 property sample: " + v6PropertyStats.retryingCases + "/512 required retries; maximum " +
  v6PropertyStats.maximumPresenterAttempts + "/4096 attempts");
console.log("v7 property sample: " + v7PropertyCount + " deterministic schedules, all weekly roles disjoint");
