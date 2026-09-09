"use strict";

// Deliberately independent Node.js reference implementation for protocol v6.
// It does not import any production module and is kept compact enough to audit.

const crypto = require("node:crypto");

const DOMAINS = {
  input: "paper-question-picker/input/v6\0",
  commitment: "paper-question-picker/commitment/v6\0",
  questionKey: "paper-question-picker/rng-key/questions/v6\0",
  questionBlock: "paper-question-picker/rng-block/questions/v6\0",
  presenterKey: "paper-question-picker/rng-key/presenters/v6\0",
  presenterBlock: "paper-question-picker/rng-block/presenters/v6\0",
  plan: "paper-question-picker/plan/v6\0",
};

const IDS = {
  protocol: "paper-question-picker/v6",
  normalization: "nfc-course-table/v2",
  rng: "sha256-ctr-split-hex-u64be-u32be-reject/v3",
  schedule: "variable-week-min-count-plus-uniform-presenter-matching/v1",
};

const MAX_PRESENTER_ATTEMPTS = 4096;
const UINT32_RANGE = 0x100000000;
const TRIM_EDGES = /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function assertNoLoneSurrogates(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("invalid Unicode surrogate");
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("invalid Unicode surrogate");
    }
  }
}

function normalizeLine(value) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) throw new Error("expected one line of text");
  assertNoLoneSurrogates(value);
  const normalized = value.normalize("NFC").replace(TRIM_EDGES, "");
  if (!normalized || Buffer.byteLength(normalized, "utf8") > 4096) throw new Error("invalid normalized label");
  return normalized;
}

function canonicalizeInput(studentNames, courseWeeks) {
  if (!Array.isArray(studentNames) || !Array.isArray(courseWeeks)) throw new Error("invalid input arrays");
  if (studentNames.length < 9 || studentNames.length > 10000 || !courseWeeks.length) {
    throw new Error("invalid input size");
  }
  const students = studentNames.map(normalizeLine);
  if (new Set(students).size !== students.length) throw new Error("duplicate students");

  const labels = new Set();
  const allPapers = [];
  const normalizedWeeks = courseWeeks.map(function normalizeWeek(week) {
    if (!week || Array.isArray(week) || typeof week !== "object" ||
        Object.keys(week).sort().join("\0") !== "label\0papers") throw new Error("invalid course week");
    const label = normalizeLine(week.label);
    if (labels.has(label)) throw new Error("duplicate week labels");
    labels.add(label);
    if (!Array.isArray(week.papers) || (week.papers.length !== 3 && week.papers.length !== 4)) {
      throw new Error("invalid paper count in week");
    }
    const papers = week.papers.map(normalizeLine);
    allPapers.push.apply(allPapers, papers);
    return { label: label, papers: papers };
  });
  if (allPapers.length !== students.length || new Set(allPapers).size !== allPapers.length) {
    throw new Error("paper count or uniqueness mismatch");
  }
  if (Math.max.apply(null, normalizedWeeks.map(function size(week) { return week.papers.length; })) * 3 > students.length) {
    throw new Error("not enough weekly questioners");
  }
  const input = { students: students, courseWeeks: normalizedWeeks };
  if (Buffer.byteLength(JSON.stringify(input), "utf8") > 8 * 1024 * 1024) throw new Error("input too large");
  return input;
}

function canonicalInput(students, courseWeeks) {
  return JSON.stringify(canonicalizeInput(students, courseWeeks));
}

function inputDigest(students, courseWeeks) {
  return sha256Hex(DOMAINS.input + canonicalInput(students, courseWeeks));
}

function createPrng(seedHex, digestHex, role) {
  if (!/^[0-9a-f]{64}$/.test(seedHex) || !/^[0-9a-f]{64}$/.test(digestHex)) {
    throw new Error("invalid seed or digest");
  }
  const keyDomain = role === "questions" ? DOMAINS.questionKey : DOMAINS.presenterKey;
  const blockDomain = role === "questions" ? DOMAINS.questionBlock : DOMAINS.presenterBlock;
  if (role !== "questions" && role !== "presenters") throw new Error("invalid random role");
  const key = sha256Hex(keyDomain + seedHex + digestHex);
  let counter = 0n;
  let block = Buffer.alloc(0);
  let offset = 0;

  function refill() {
    block = Buffer.from(sha256Hex(blockDomain + key + counter.toString(16).padStart(16, "0")), "hex");
    counter += 1n;
    offset = 0;
  }

  function nextByte() {
    if (offset === block.length) refill();
    const value = block[offset];
    offset += 1;
    return value;
  }

  function nextUint32() {
    return (((nextByte() * 0x1000000) + (nextByte() << 16) + (nextByte() << 8) + nextByte()) >>> 0);
  }

  function uniform(maxExclusive) {
    const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
    for (;;) {
      const value = nextUint32();
      if (value < limit) return value % maxExclusive;
    }
  }

  function shuffle(input) {
    const output = input.slice();
    for (let index = output.length - 1; index > 0; index -= 1) {
      const replacement = uniform(index + 1);
      const saved = output[index];
      output[index] = output[replacement];
      output[replacement] = saved;
    }
    return output;
  }

  return { nextUint32: nextUint32, uniform: uniform, shuffle: shuffle };
}

function findPresenterMatching(assignments, indexes, shuffle, maxAttempts) {
  const limit = maxAttempts === undefined ? MAX_PRESENTER_ATTEMPTS : maxAttempts;
  for (let attempt = 1; attempt <= limit; attempt += 1) {
    const candidate = shuffle(indexes);
    if (candidate.every(function allowed(presenterIndex, paperIndex) {
      return !assignments[paperIndex].studentIndexes.includes(presenterIndex);
    })) return { matching: candidate, attempts: attempt };
  }
  throw new Error("reference presenter matching failed after " + limit + " attempts");
}

function makePlanWithStats(students, courseWeeks, seedHex) {
  const input = canonicalizeInput(students, courseWeeks);
  const digest = inputDigest(input.students, input.courseWeeks);
  const questions = createPrng(seedHex, digest, "questions");
  const presenterRandom = createPrng(seedHex, digest, "presenters");
  const counts = new Array(input.students.length).fill(0);
  const weeks = [];
  let paperCursor = 0;

  input.courseWeeks.forEach(function makeWeek(courseWeek, weekIndex) {
    const needed = courseWeek.papers.length * 3;
    const levels = Array.from(new Set(counts)).sort(function ascending(left, right) { return left - right; });
    const selected = [];
    for (const level of levels) {
      const candidates = [];
      for (let studentIndex = 0; studentIndex < counts.length; studentIndex += 1) {
        if (counts[studentIndex] === level) candidates.push(studentIndex);
      }
      const shuffled = questions.shuffle(candidates);
      selected.push.apply(selected, shuffled.slice(0, needed - selected.length));
      if (selected.length === needed) break;
    }
    if (selected.length !== needed) throw new Error("reference question schedule failed");
    const order = questions.shuffle(selected);
    const assignments = courseWeek.papers.map(function makeAssignment(_paper, offset) {
      return {
        paperIndex: paperCursor + offset,
        studentIndexes: order.slice(offset * 3, offset * 3 + 3),
        presenterIndex: null,
      };
    });
    selected.forEach(function increment(index) { counts[index] += 1; });
    weeks.push({ weekIndex: weekIndex, assignments: assignments });
    paperCursor += courseWeek.papers.length;
  });
  if (counts.some(function invalid(count) { return count !== 3; })) {
    throw new Error("reference question counts failed");
  }

  const flat = weeks.flatMap(function flatten(week) { return week.assignments; });
  const indexes = Array.from({ length: students.length }, function indexValue(_value, index) { return index; });
  const presenterResult = findPresenterMatching(flat, indexes, presenterRandom.shuffle, MAX_PRESENTER_ATTEMPTS);
  const matching = presenterResult.matching;
  flat.forEach(function setPresenter(assignment, paperIndex) {
    assignment.presenterIndex = matching[paperIndex];
  });
  return { plan: { weeks: weeks }, presenterAttempts: presenterResult.attempts };
}

function makePlan(students, courseWeeks, seedHex) {
  return makePlanWithStats(students, courseWeeks, seedHex).plan;
}

function planDigest(plan) {
  const canonical = {
    weeks: plan.weeks.map(function canonicalWeek(week) {
      return {
        weekIndex: week.weekIndex,
        assignments: week.assignments.map(function canonicalAssignment(assignment) {
          return {
            paperIndex: assignment.paperIndex,
            studentIndexes: assignment.studentIndexes.slice(),
            presenterIndex: assignment.presenterIndex,
          };
        }),
      };
    }),
  };
  return sha256Hex(DOMAINS.plan + JSON.stringify(canonical));
}

function receiptContext(input, issuedAt) {
  return {
    protocolId: IDS.protocol,
    normalizationId: IDS.normalization,
    rngId: IDS.rng,
    scheduleId: IDS.schedule,
    issuedAt: issuedAt,
    studentCount: input.students.length,
    paperCount: input.students.length,
    weekCount: input.courseWeeks.length,
    weekPaperCounts: input.courseWeeks.map(function size(week) { return week.papers.length; }),
    studentsPerPaper: 3,
    finalSelectionsPerStudent: 3,
    presentersPerPaper: 1,
    finalPresentationsPerStudent: 1,
  };
}

function commitment(students, courseWeeks, seedHex, issuedAt) {
  const input = canonicalizeInput(students, courseWeeks);
  return sha256Hex(DOMAINS.commitment + JSON.stringify(receiptContext(input, issuedAt)) +
    inputDigest(input.students, input.courseWeeks) + seedHex);
}

module.exports = {
  IDS: IDS,
  MAX_PRESENTER_ATTEMPTS: MAX_PRESENTER_ATTEMPTS,
  canonicalInput: canonicalInput,
  canonicalizeInput: canonicalizeInput,
  commitment: commitment,
  createPrng: createPrng,
  findPresenterMatching: findPresenterMatching,
  inputDigest: inputDigest,
  makePlan: makePlan,
  makePlanWithStats: makePlanWithStats,
  planDigest: planDigest,
};
