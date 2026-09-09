"use strict";

// Deliberately independent Node.js reference implementation for protocol v5.
// It does not import audit-core.js and is kept small enough to audit by hand.

const crypto = require("node:crypto");

const DOMAINS = {
  input: "paper-question-picker/input/v5\0",
  commitment: "paper-question-picker/commitment/v5\0",
  questionKey: "paper-question-picker/rng-key/questions/v5\0",
  questionBlock: "paper-question-picker/rng-block/questions/v5\0",
  presenterKey: "paper-question-picker/rng-key/presenters/v5\0",
  presenterBlock: "paper-question-picker/rng-block/presenters/v5\0",
  plan: "paper-question-picker/plan/v5\0",
};

const IDS = {
  protocol: "paper-question-picker/v5",
  normalization: "nfc-lines/v1",
  rng: "sha256-ctr-split-u64be-u32be-reject/v2",
  schedule: "min-count-plus-uniform-presenter-matching/v2",
};

function bytes(value) {
  return Buffer.from(value, "utf8");
}

function hash() {
  const digest = crypto.createHash("sha256");
  for (const value of arguments) digest.update(value);
  return digest.digest();
}

function u32(value) {
  const output = Buffer.alloc(4);
  output.writeUInt32BE(value, 0);
  return output;
}

function u64(value) {
  const output = Buffer.alloc(8);
  output.writeBigUInt64BE(value, 0);
  return output;
}

function lp(value) {
  return Buffer.concat([u32(value.length), value]);
}

function text(value) {
  return lp(bytes(value));
}

function encodeInput(students, papers) {
  const parts = [u32(students.length)];
  students.forEach(function addStudent(name) { parts.push(text(name)); });
  parts.push(u32(papers.length));
  papers.forEach(function addPaper(title) { parts.push(text(title)); });
  return Buffer.concat(parts);
}

function inputDigest(students, papers) {
  return hash(bytes(DOMAINS.input), lp(encodeInput(students, papers))).toString("hex");
}

function createPrng(seedHex, digestHex, role) {
  const keyDomain = role === "questions" ? DOMAINS.questionKey : DOMAINS.presenterKey;
  const blockDomain = role === "questions" ? DOMAINS.questionBlock : DOMAINS.presenterBlock;
  const key = hash(bytes(keyDomain), Buffer.from(seedHex, "hex"), Buffer.from(digestHex, "hex"));
  let counter = 0n;
  let block = Buffer.alloc(0);
  let offset = 0;

  function refill() {
    block = hash(bytes(blockDomain), key, u64(counter));
    counter += 1n;
    offset = 0;
  }

  function nextUint32() {
    const output = Buffer.alloc(4);
    for (let index = 0; index < 4; index += 1) {
      if (offset === block.length) refill();
      output[index] = block[offset];
      offset += 1;
    }
    return output.readUInt32BE(0);
  }

  function uniform(n) {
    const range = 0x100000000;
    const limit = Math.floor(range / n) * n;
    for (;;) {
      const value = nextUint32();
      if (value < limit) return value % n;
    }
  }

  function shuffle(input) {
    const output = input.slice();
    for (let index = output.length - 1; index >= 1; index -= 1) {
      const replacement = uniform(index + 1);
      const saved = output[index];
      output[index] = output[replacement];
      output[replacement] = saved;
    }
    return output;
  }

  return { nextUint32: nextUint32, uniform: uniform, shuffle: shuffle };
}

function makePlan(students, papers, seedHex) {
  const digest = inputDigest(students, papers);
  const questions = createPrng(seedHex, digest, "questions");
  const presenters = createPrng(seedHex, digest, "presenters");
  const counts = new Array(students.length).fill(0);
  const weeks = [];

  for (let weekIndex = 0; weekIndex < papers.length / 3; weekIndex += 1) {
    const levels = Array.from(new Set(counts)).sort(function ascending(left, right) { return left - right; });
    const selected = [];
    for (const level of levels) {
      const candidates = [];
      for (let studentIndex = 0; studentIndex < students.length; studentIndex += 1) {
        if (counts[studentIndex] === level && !selected.includes(studentIndex)) {
          candidates.push(studentIndex);
        }
      }
      const shuffled = questions.shuffle(candidates);
      selected.push.apply(selected, shuffled.slice(0, 9 - selected.length));
      if (selected.length === 9) break;
    }
    if (selected.length !== 9) throw new Error("reference question schedule failed");
    const order = questions.shuffle(selected);
    const assignments = [];
    for (let paperOffset = 0; paperOffset < 3; paperOffset += 1) {
      assignments.push({
        paperIndex: weekIndex * 3 + paperOffset,
        studentIndexes: order.slice(paperOffset * 3, paperOffset * 3 + 3),
        presenterIndex: null,
      });
    }
    selected.forEach(function increment(index) { counts[index] += 1; });
    weeks.push({ weekIndex: weekIndex, assignments: assignments });
  }

  if (counts.some(function invalid(count) { return count !== 3; })) {
    throw new Error("reference question counts failed");
  }

  const flat = weeks.flatMap(function flatten(week) { return week.assignments; });
  const indexes = Array.from({ length: students.length }, function indexValue(_value, index) { return index; });
  let matching = null;
  for (let attempt = 0; attempt < 4096; attempt += 1) {
    const candidate = presenters.shuffle(indexes);
    if (candidate.every(function allowed(presenterIndex, paperIndex) {
      return !flat[paperIndex].studentIndexes.includes(presenterIndex);
    })) {
      matching = candidate;
      break;
    }
  }
  if (!matching) throw new Error("reference presenter matching failed");
  flat.forEach(function setPresenter(assignment, paperIndex) {
    assignment.presenterIndex = matching[paperIndex];
  });
  return { weeks: weeks };
}

function encodePlan(plan) {
  const parts = [u32(plan.weeks.length)];
  plan.weeks.forEach(function addWeek(week) {
    parts.push(u32(3));
    week.assignments.forEach(function addAssignment(assignment) {
      parts.push(u32(assignment.paperIndex), u32(3));
      assignment.studentIndexes.forEach(function addQuestioner(index) { parts.push(u32(index)); });
      parts.push(u32(1), u32(assignment.presenterIndex));
    });
  });
  return Buffer.concat(parts);
}

function planDigest(plan) {
  return hash(bytes(DOMAINS.plan), lp(encodePlan(plan))).toString("hex");
}

function commitment(students, papers, seedHex, issuedAt) {
  const count = students.length;
  const context = Buffer.concat([
    text(IDS.protocol),
    text(IDS.normalization),
    text(IDS.rng),
    text(IDS.schedule),
    text(issuedAt),
    u32(count), u32(count), u32(3), u32(3), u32(3), u32(1), u32(1),
  ]);
  return hash(
    bytes(DOMAINS.commitment),
    lp(context),
    Buffer.from(inputDigest(students, papers), "hex"),
    Buffer.from(seedHex, "hex"),
  ).toString("hex");
}

module.exports = {
  IDS: IDS,
  commitment: commitment,
  createPrng: createPrng,
  inputDigest: inputDigest,
  makePlan: makePlan,
  planDigest: planDigest,
};
