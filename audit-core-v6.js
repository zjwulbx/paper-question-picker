(function attachAuditCoreV6(root, factory) {
  "use strict";

  let base = root && root.AuditCore;
  if (typeof module === "object" && module.exports && typeof require === "function") {
    base = require("./audit-core.js");
  }
  const api = factory(base);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AuditCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createAuditCoreV6(Base) {
  "use strict";

  if (!Base || typeof Base.sha256Hex !== "function") {
    throw new Error("v5 审计核心没有正确载入。");
  }

  const PROTOCOL_ID = "paper-question-picker/v6";
  const NORMALIZATION_ID = "nfc-course-table/v2";
  const RNG_ID = "sha256-ctr-split-hex-u64be-u32be-reject/v3";
  const SCHEDULE_ID = "variable-week-min-count-plus-uniform-presenter-matching/v1";
  const RECEIPT_FORMAT = "paper-question-picker-commitment";
  const REPORT_FORMAT = "paper-question-picker-final-audit";
  const FORMAT_VERSION = 6;
  const MAX_ITEMS = 10000;
  const MAX_INPUT_BYTES = 8 * 1024 * 1024;
  const MAX_PRESENTER_ATTEMPTS = 4096;
  const UINT32_RANGE = 0x100000000;

  const D_INPUT = "paper-question-picker/input/v6\0";
  const D_COMMIT = "paper-question-picker/commitment/v6\0";
  const D_QUESTION_RNG_KEY = "paper-question-picker/rng-key/questions/v6\0";
  const D_QUESTION_RNG_BLOCK = "paper-question-picker/rng-block/questions/v6\0";
  const D_PRESENTER_RNG_KEY = "paper-question-picker/rng-key/presenters/v6\0";
  const D_PRESENTER_RNG_BLOCK = "paper-question-picker/rng-block/presenters/v6\0";
  const D_PLAN = "paper-question-picker/plan/v6\0";

  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function exactKeys(value, keys, code, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(code, label + "格式不正确。");
    const actual = Object.keys(value).sort();
    const expected = keys.slice().sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(code, label + "字段不正确。");
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function same(item, index) { return item === right[index]; });
  }

  function courseWeeksEqual(left, right) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every(function sameWeek(week, index) {
        const other = right[index];
        return Boolean(week && other && week.label === other.label &&
          Array.isArray(week.papers) && Array.isArray(other.papers) && arraysEqual(week.papers, other.papers));
      });
  }

  function isCanonicalIso(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
      Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
  }

  function requireIso(value, code, label) {
    if (!isCanonicalIso(value)) fail(code, label + "必须是规范 UTC ISO 8601 时间。");
    return value;
  }

  function requireHex32(value, code, label) {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
      fail(code, label + "必须是 64 位小写十六进制文本。");
    }
    return value;
  }

  function normalizeSingle(value, label) {
    if (typeof value !== "string" || /[\r\n]/.test(value)) fail("INVALID_INPUT", label + "必须是单行文本。");
    const lines = Base.parseTextLines(value, label);
    if (lines.length !== 1) fail("INVALID_INPUT", label + "不能为空。");
    return lines[0];
  }

  function byteLength(value) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(value).byteLength;
    if (typeof Buffer === "function") return Buffer.byteLength(value, "utf8");
    return unescape(encodeURIComponent(value)).length;
  }

  function canonicalizeInput(studentNames, courseWeeks) {
    if (!Array.isArray(studentNames) || !Array.isArray(courseWeeks)) {
      fail("INVALID_INPUT", "学生名单和分周课程表必须是数组。");
    }
    if (studentNames.length < 9 || studentNames.length > MAX_ITEMS) {
      fail("INVALID_INPUT", "学生人数必须为 9 至 10000 人。");
    }
    const students = studentNames.map(function normalizeStudent(value, index) {
      return normalizeSingle(value, "第 " + (index + 1) + " 位学生姓名");
    });
    if (new Set(students).size !== students.length) fail("INVALID_INPUT", "学生名单含有规范化后完全相同的项目。");
    if (!courseWeeks.length || courseWeeks.length > MAX_ITEMS) fail("INVALID_INPUT", "课程表必须至少包含一周。");

    const labels = new Set();
    const papers = [];
    const weeks = courseWeeks.map(function normalizeWeek(week, weekIndex) {
      exactKeys(week, ["label", "papers"], "INVALID_INPUT", "第 " + (weekIndex + 1) + " 周课程表");
      const label = normalizeSingle(week.label, "第 " + (weekIndex + 1) + " 周标题");
      if (labels.has(label)) fail("INVALID_INPUT", "周标题含有规范化后完全相同的项目。");
      labels.add(label);
      if (!Array.isArray(week.papers) || (week.papers.length !== 3 && week.papers.length !== 4)) {
        fail("INVALID_INPUT", label + "必须恰好包含 3 或 4 篇有效论文。");
      }
      const normalizedPapers = week.papers.map(function normalizePaper(value, paperIndex) {
        const title = normalizeSingle(value, label + "第 " + (paperIndex + 1) + " 篇论文标题");
        papers.push(title);
        return title;
      });
      return { label: label, papers: normalizedPapers };
    });

    if (papers.length !== students.length) {
      fail("INVALID_INPUT", "有效论文数必须与学生人数一致。");
    }
    if (new Set(papers).size !== papers.length) fail("INVALID_INPUT", "论文列表含有规范化后完全相同的项目。");
    const largestWeek = Math.max.apply(null, weeks.map(function weekSize(week) { return week.papers.length; }));
    if (largestWeek * 3 > students.length) {
      fail("INVALID_INPUT", "学生人数不足以保证同一周所有提问人互不重复。");
    }
    const input = { students: students, courseWeeks: weeks };
    if (byteLength(JSON.stringify(input)) > MAX_INPUT_BYTES) {
      fail("INVALID_INPUT", "规范输入编码不能超过 8 MiB。");
    }
    return input;
  }

  function canonicalInput(studentNames, courseWeeks) {
    return JSON.stringify(canonicalizeInput(studentNames, courseWeeks));
  }

  function inputDigest(studentNames, courseWeeks) {
    return Base.sha256Hex(D_INPUT + canonicalInput(studentNames, courseWeeks));
  }

  function createPrng(seedHex, inputDigestHex, purpose) {
    const seed = requireHex32(seedHex, "INVALID_SEED", "随机种子");
    const digest = requireHex32(inputDigestHex, "INVALID_INPUT_DIGEST", "输入摘要");
    let keyDomain;
    let blockDomain;
    if (purpose === undefined || purpose === "questions") {
      keyDomain = D_QUESTION_RNG_KEY;
      blockDomain = D_QUESTION_RNG_BLOCK;
    } else if (purpose === "presenters") {
      keyDomain = D_PRESENTER_RNG_KEY;
      blockDomain = D_PRESENTER_RNG_BLOCK;
    } else {
      fail("INVALID_RANDOM_PURPOSE", "v6 随机流用途必须是 questions 或 presenters。");
    }
    const key = Base.sha256Hex(keyDomain + seed + digest);
    let counterHigh = 0;
    let counterLow = 0;
    let block = new Uint8Array(0);
    let offset = 0;

    function refill() {
      const counter = counterHigh.toString(16).padStart(8, "0") + counterLow.toString(16).padStart(8, "0");
      const hex = Base.sha256Hex(blockDomain + key + counter);
      block = new Uint8Array(32);
      for (let index = 0; index < 32; index += 1) block[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
      offset = 0;
      if (counterHigh === 0xffffffff && counterLow === 0xffffffff) {
        counterHigh = null;
        counterLow = null;
      } else {
        counterLow = (counterLow + 1) >>> 0;
        if (counterLow === 0) counterHigh = (counterHigh + 1) >>> 0;
      }
    }

    function nextByte() {
      if (offset >= block.length) {
        if (counterHigh === null) fail("PRNG_EXHAUSTED", "SHA-256 counter 随机流已经耗尽。");
        refill();
      }
      const value = block[offset];
      offset += 1;
      return value;
    }

    function nextBytes(length) {
      if (!Number.isSafeInteger(length) || length < 0) fail("INVALID_RANDOM_LENGTH", "随机字节数量必须是非负整数。");
      const output = new Uint8Array(length);
      for (let index = 0; index < length; index += 1) output[index] = nextByte();
      return output;
    }

    function nextUint32() {
      const bytes = nextBytes(4);
      return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false);
    }

    function uniform(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
        fail("INVALID_RANDOM_BOUND", "无偏整数上限必须是 1..2^32 的整数。");
      }
      const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
      let value;
      do value = nextUint32(); while (value >= limit);
      return value % maxExclusive;
    }

    function shuffle(items) {
      if (!Array.isArray(items)) fail("INVALID_SHUFFLE_INPUT", "洗牌输入必须是数组。");
      const output = items.slice();
      for (let index = output.length - 1; index > 0; index -= 1) {
        const swapIndex = uniform(index + 1);
        const saved = output[index];
        output[index] = output[swapIndex];
        output[swapIndex] = saved;
      }
      return output;
    }

    return { nextBytes: nextBytes, nextUint32: nextUint32, uniform: uniform, nextInt: uniform, shuffle: shuffle };
  }

  function makePlan(input, seedHex) {
    const digest = inputDigest(input.students, input.courseWeeks);
    const questionRandom = createPrng(seedHex, digest, "questions");
    const presenterRandom = createPrng(seedHex, digest, "presenters");
    const counts = new Array(input.students.length).fill(0);
    const weeks = [];
    let paperCursor = 0;

    input.courseWeeks.forEach(function buildWeek(courseWeek, weekIndex) {
      const needed = courseWeek.papers.length * 3;
      const levels = Array.from(new Set(counts)).sort(function ascending(left, right) { return left - right; });
      const selected = [];
      for (const level of levels) {
        const candidates = [];
        for (let index = 0; index < counts.length; index += 1) {
          if (counts[index] === level) candidates.push(index);
        }
        const shuffled = questionRandom.shuffle(candidates);
        selected.push.apply(selected, shuffled.slice(0, needed - selected.length));
        if (selected.length === needed) break;
      }
      if (selected.length !== needed) fail("SCHEDULE_FAILED", "无法生成同周提问人互不重复的完整安排。");
      const weeklyOrder = questionRandom.shuffle(selected);
      const assignments = courseWeek.papers.map(function buildAssignment(_paper, paperOffset) {
        return {
          paperIndex: paperCursor + paperOffset,
          studentIndexes: weeklyOrder.slice(paperOffset * 3, paperOffset * 3 + 3),
          presenterIndex: null,
        };
      });
      selected.forEach(function increment(index) { counts[index] += 1; });
      weeks.push({ weekIndex: weekIndex, assignments: assignments });
      paperCursor += courseWeek.papers.length;
    });

    if (counts.some(function notThree(count) { return count !== 3; })) {
      fail("SCHEDULE_FAILED", "无法生成每位学生恰好提问三次的完整安排。");
    }

    const assignments = weeks.flatMap(function flatten(week) { return week.assignments; });
    const indexes = Array.from({ length: input.students.length }, function indexValue(_value, index) { return index; });
    let presenters = null;
    for (let attempt = 0; attempt < MAX_PRESENTER_ATTEMPTS; attempt += 1) {
      const candidate = presenterRandom.shuffle(indexes);
      if (candidate.every(function allowed(presenterIndex, paperIndex) {
        return !assignments[paperIndex].studentIndexes.includes(presenterIndex);
      })) {
        presenters = candidate;
        break;
      }
    }
    if (!presenters) fail("PRESENTER_MATCHING_FAILED", "报告人均匀匹配超过安全重试上限，请重新生成。");
    assignments.forEach(function assignPresenter(assignment, paperIndex) {
      assignment.presenterIndex = presenters[paperIndex];
    });
    return { weeks: weeks };
  }

  function inspectPlan(plan, courseWeeks, count) {
    exactKeys(plan, ["weeks"], "INVALID_PLAN", "v6 零基计划");
    if (!Array.isArray(plan.weeks) || plan.weeks.length !== courseWeeks.length) {
      fail("INVALID_PLAN", "v6 零基计划周数不正确。");
    }
    const questionTotals = new Array(count).fill(0);
    const presenters = [];
    let paperCursor = 0;
    plan.weeks.forEach(function inspectWeek(week, weekIndex) {
      exactKeys(week, ["weekIndex", "assignments"], "INVALID_PLAN", "v6 零基周次");
      const weekSize = courseWeeks[weekIndex].papers.length;
      if (week.weekIndex !== weekIndex || !Array.isArray(week.assignments) || week.assignments.length !== weekSize) {
        fail("INVALID_PLAN", "v6 零基周次编号或论文数量不正确。");
      }
      const weeklyQuestioners = [];
      week.assignments.forEach(function inspectAssignment(assignment, paperOffset) {
        exactKeys(assignment, ["paperIndex", "studentIndexes", "presenterIndex"], "INVALID_PLAN", "v6 零基论文安排");
        const paperIndex = paperCursor + paperOffset;
        if (assignment.paperIndex !== paperIndex || !Array.isArray(assignment.studentIndexes) ||
            assignment.studentIndexes.length !== 3) {
          fail("INVALID_PLAN", "v6 论文下标或提问学生数量不正确。");
        }
        assignment.studentIndexes.forEach(function questioner(index) {
          if (!Number.isInteger(index) || index < 0 || index >= count) fail("INVALID_PLAN", "v6 提问学生下标超出范围。");
          questionTotals[index] += 1;
          weeklyQuestioners.push(index);
        });
        if (!Number.isInteger(assignment.presenterIndex) || assignment.presenterIndex < 0 || assignment.presenterIndex >= count) {
          fail("INVALID_PLAN", "v6 报告人下标超出范围。");
        }
        if (assignment.studentIndexes.includes(assignment.presenterIndex)) {
          fail("INVALID_PLAN", "v6 同一篇论文的报告人不得与提问人重复。");
        }
        presenters.push(assignment.presenterIndex);
      });
      if (weeklyQuestioners.length !== weekSize * 3 || new Set(weeklyQuestioners).size !== weekSize * 3) {
        fail("INVALID_PLAN", "v6 同一周的提问学生必须互不重复。");
      }
      paperCursor += weekSize;
    });
    if (paperCursor !== count || questionTotals.some(function notThree(total) { return total !== 3; })) {
      fail("INVALID_PLAN", "v6 论文覆盖或学生提问总次数不正确。");
    }
    if (presenters.length !== count || new Set(presenters).size !== count) {
      fail("INVALID_PLAN", "v6 每位学生必须恰好报告一篇论文。");
    }
    return clone(plan);
  }

  function planDigest(plan, courseWeeks, studentCount) {
    const count = studentCount === undefined
      ? courseWeeks.reduce(function total(sum, week) { return sum + week.papers.length; }, 0)
      : studentCount;
    const canonical = canonicalPlan(plan, courseWeeks, count);
    return Base.sha256Hex(D_PLAN + JSON.stringify(canonical));
  }

  function canonicalPlan(plan, courseWeeks, count) {
    inspectPlan(plan, courseWeeks, count);
    return {
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
  }

  function planToSchedule(input, plan, createdAt) {
    return {
      students: input.students.map(function student(name, index) { return { id: "student-" + (index + 1), name: name }; }),
      weeks: plan.weeks.map(function week(planWeek, weekIndex) {
        const courseWeek = input.courseWeeks[weekIndex];
        return {
          id: "week-" + (weekIndex + 1),
          label: courseWeek.label,
          assignments: planWeek.assignments.map(function assignment(planAssignment, paperOffset) {
            return {
              paper: courseWeek.papers[paperOffset],
              studentIds: planAssignment.studentIndexes.map(function id(index) { return "student-" + (index + 1); }),
              presenterId: "student-" + (planAssignment.presenterIndex + 1),
            };
          }),
          revealed: new Array(courseWeek.papers.length).fill(false),
        };
      }),
      createdAt: createdAt,
    };
  }

  function createDeterministicSchedule(studentNames, courseWeeks, seedHex, options) {
    const input = canonicalizeInput(studentNames, courseWeeks);
    requireHex32(seedHex, "INVALID_SEED", "随机种子");
    const createdAt = options && options.createdAt !== undefined
      ? requireIso(options.createdAt, "INVALID_CREATED_AT", "抽签创建时间")
      : "1970-01-01T00:00:00.000Z";
    return planToSchedule(input, makePlan(input, seedHex), createdAt);
  }

  function receiptContext(issuedAt, input) {
    return {
      protocolId: PROTOCOL_ID,
      normalizationId: NORMALIZATION_ID,
      rngId: RNG_ID,
      scheduleId: SCHEDULE_ID,
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

  function computeCommitment(studentNames, courseWeeks, seedHex, issuedAt) {
    const input = canonicalizeInput(studentNames, courseWeeks);
    const seed = requireHex32(seedHex, "INVALID_SEED", "随机种子");
    requireIso(issuedAt, "INVALID_ISSUED_AT", "承诺签发时间");
    const digest = inputDigest(input.students, input.courseWeeks);
    return Base.sha256Hex(D_COMMIT + JSON.stringify(receiptContext(issuedAt, input)) + digest + seed);
  }

  function createAuditedSchedule(studentNames, courseWeeks, options) {
    const settings = options || {};
    const input = canonicalizeInput(studentNames, courseWeeks);
    const seedHex = settings.seedHex === undefined ? Base.generateSeed() : settings.seedHex;
    requireHex32(seedHex, "INVALID_SEED", "随机种子");
    const issuedAt = settings.createdAt === undefined
      ? new Date().toISOString()
      : requireIso(settings.createdAt, "INVALID_CREATED_AT", "抽签创建时间");
    const plan = makePlan(input, seedHex);
    const schedule = planToSchedule(input, plan, issuedAt);
    schedule.audit = {
      protocolId: PROTOCOL_ID,
      normalizationId: NORMALIZATION_ID,
      rngId: RNG_ID,
      scheduleId: SCHEDULE_ID,
      issuedAt: issuedAt,
      inputDigest: inputDigest(input.students, input.courseWeeks),
      commitment: computeCommitment(input.students, input.courseWeeks, seedHex, issuedAt),
      planDigest: planDigest(plan, input.courseWeeks, input.students.length),
      seedHex: seedHex,
      commitmentConfirmedAt: null,
    };
    return schedule;
  }

  function scheduleToInput(schedule) {
    return {
      students: schedule.students.map(function name(student) { return student.name; }),
      courseWeeks: schedule.weeks.map(function courseWeek(week) {
        return { label: week.label, papers: week.assignments.map(function paper(assignment) { return assignment.paper; }) };
      }),
    };
  }

  function scheduleToPlan(schedule, input) {
    const indexById = new Map(schedule.students.map(function indexEntry(student, index) { return [student.id, index]; }));
    let paperCursor = 0;
    return {
      weeks: schedule.weeks.map(function planWeek(week, weekIndex) {
        const courseWeek = input.courseWeeks[weekIndex];
        const entry = {
          weekIndex: weekIndex,
          assignments: week.assignments.map(function planAssignment(assignment, offset) {
            if (assignment.paper !== courseWeek.papers[offset]) fail("INVALID_SCHEDULE", "v6 论文顺序与规范输入不一致。");
            if (!indexById.has(assignment.presenterId)) fail("INVALID_SCHEDULE", "v6 安排含有未知报告人编号。");
            return {
              paperIndex: paperCursor + offset,
              studentIndexes: assignment.studentIds.map(function questioner(id) {
                if (!indexById.has(id)) fail("INVALID_SCHEDULE", "v6 安排含有未知提问学生编号。");
                return indexById.get(id);
              }),
              presenterIndex: indexById.get(assignment.presenterId),
            };
          }),
        };
        paperCursor += courseWeek.papers.length;
        return entry;
      }),
    };
  }

  function inspectSchedule(schedule, withAudit) {
    exactKeys(schedule, withAudit ? ["students", "weeks", "createdAt", "audit"] : ["students", "weeks", "createdAt"],
      "INVALID_SCHEDULE", "v6 抽签安排");
    requireIso(schedule.createdAt, "INVALID_SCHEDULE", "v6 抽签创建时间");
    if (!Array.isArray(schedule.students) || !Array.isArray(schedule.weeks)) fail("INVALID_SCHEDULE", "v6 抽签安排缺少学生或周次。");
    schedule.students.forEach(function student(student, index) {
      exactKeys(student, ["id", "name"], "INVALID_SCHEDULE", "v6 学生记录");
      if (student.id !== "student-" + (index + 1) || typeof student.name !== "string") {
        fail("INVALID_SCHEDULE", "v6 学生编号或姓名不正确。");
      }
    });
    let complete = true;
    schedule.weeks.forEach(function week(week, index) {
      exactKeys(week, ["id", "label", "assignments", "revealed"], "INVALID_SCHEDULE", "v6 周次记录");
      if (week.id !== "week-" + (index + 1) || typeof week.label !== "string" || !Array.isArray(week.assignments) ||
          (week.assignments.length !== 3 && week.assignments.length !== 4) || !Array.isArray(week.revealed) ||
          week.revealed.length !== week.assignments.length || week.revealed.some(function invalid(value) { return typeof value !== "boolean"; })) {
        fail("INVALID_SCHEDULE", "v6 周次编号、标题、论文数量或揭晓状态不正确。");
      }
      if (!week.revealed.every(Boolean)) complete = false;
      week.assignments.forEach(function assignment(assignment) {
        exactKeys(assignment, ["paper", "studentIds", "presenterId"], "INVALID_SCHEDULE", "v6 论文安排");
        if (typeof assignment.paper !== "string" || !Array.isArray(assignment.studentIds) ||
            assignment.studentIds.length !== 3 || typeof assignment.presenterId !== "string") {
          fail("INVALID_SCHEDULE", "v6 论文安排格式不正确。");
        }
      });
    });
    const raw = scheduleToInput(schedule);
    const input = canonicalizeInput(raw.students, raw.courseWeeks);
    if (!arraysEqual(raw.students, input.students) || !courseWeeksEqual(raw.courseWeeks, input.courseWeeks)) {
      fail("INVALID_SCHEDULE", "v6 安排中的输入不是规范形。");
    }
    const plan = scheduleToPlan(schedule, input);
    inspectPlan(plan, input.courseWeeks, input.students.length);
    return { input: input, plan: plan, complete: complete };
  }

  function inspectAudit(schedule) {
    const inspected = inspectSchedule(schedule, true);
    exactKeys(schedule.audit, ["protocolId", "normalizationId", "rngId", "scheduleId", "issuedAt", "inputDigest",
      "commitment", "planDigest", "seedHex", "commitmentConfirmedAt"], "INVALID_AUDIT", "v6 私密审计元数据");
    if (schedule.audit.protocolId !== PROTOCOL_ID || schedule.audit.normalizationId !== NORMALIZATION_ID ||
        schedule.audit.rngId !== RNG_ID || schedule.audit.scheduleId !== SCHEDULE_ID) {
      fail("UNSUPPORTED_PROTOCOL", "v6 抽签审计协议标识不受支持。");
    }
    requireIso(schedule.audit.issuedAt, "INVALID_AUDIT", "v6 承诺签发时间");
    if (schedule.audit.issuedAt !== schedule.createdAt) fail("INVALID_AUDIT", "v6 承诺签发时间与安排创建时间不一致。");
    requireHex32(schedule.audit.inputDigest, "INVALID_AUDIT", "v6 输入摘要");
    requireHex32(schedule.audit.commitment, "INVALID_AUDIT", "v6 承诺码");
    requireHex32(schedule.audit.planDigest, "INVALID_AUDIT", "v6 计划摘要");
    requireHex32(schedule.audit.seedHex, "INVALID_AUDIT", "v6 随机种子");
    if (schedule.audit.commitmentConfirmedAt !== null) {
      requireIso(schedule.audit.commitmentConfirmedAt, "INVALID_AUDIT", "v6 承诺确认时间");
      if (Date.parse(schedule.audit.commitmentConfirmedAt) < Date.parse(schedule.createdAt)) {
        fail("INVALID_AUDIT", "v6 承诺确认时间不能早于安排创建时间。");
      }
    } else if (schedule.weeks.some(function revealed(week) { return week.revealed.some(Boolean); })) {
      fail("INVALID_AUDIT", "v6 尚未确认公开承诺的安排不能包含已揭晓结果。");
    }
    const input = inspected.input;
    const digest = inputDigest(input.students, input.courseWeeks);
    const commitment = computeCommitment(input.students, input.courseWeeks, schedule.audit.seedHex, schedule.audit.issuedAt);
    const replay = makePlan(input, schedule.audit.seedHex);
    const replayDigest = planDigest(replay, input.courseWeeks, input.students.length);
    if (digest !== schedule.audit.inputDigest || commitment !== schedule.audit.commitment ||
        replayDigest !== schedule.audit.planDigest ||
        JSON.stringify(canonicalPlan(replay, input.courseWeeks, input.students.length)) !==
          JSON.stringify(canonicalPlan(inspected.plan, input.courseWeeks, input.students.length))) {
      fail("AUDIT_MISMATCH", "v6 私密审计数据无法重现当前提问人与报告人安排。");
    }
    return inspected;
  }

  const RECEIPT_KEYS = ["format", "version", "protocolId", "normalizationId", "rngId", "scheduleId", "issuedAt",
    "studentCount", "paperCount", "weekCount", "weekPaperCounts", "studentsPerPaper", "finalSelectionsPerStudent",
    "presentersPerPaper", "finalPresentationsPerStudent", "inputDigest", "commitment"];

  function createPublicReceiptV6(schedule) {
    const inspected = inspectAudit(schedule);
    const context = receiptContext(schedule.audit.issuedAt, inspected.input);
    return Object.assign({ format: RECEIPT_FORMAT, version: FORMAT_VERSION }, context, {
      inputDigest: schedule.audit.inputDigest,
      commitment: schedule.audit.commitment,
    });
  }

  function parsePublicReceiptV6(candidate) {
    exactKeys(candidate, RECEIPT_KEYS, "INVALID_RECEIPT", "v6 公开承诺凭证");
    if (candidate.format !== RECEIPT_FORMAT || candidate.version !== FORMAT_VERSION) {
      fail("INVALID_RECEIPT", "这不是受支持的 v6 论文提问抽签公开承诺凭证。");
    }
    if (candidate.protocolId !== PROTOCOL_ID || candidate.normalizationId !== NORMALIZATION_ID ||
        candidate.rngId !== RNG_ID || candidate.scheduleId !== SCHEDULE_ID) {
      fail("UNSUPPORTED_PROTOCOL", "v6 公开承诺凭证协议标识不受支持。");
    }
    requireIso(candidate.issuedAt, "INVALID_RECEIPT", "v6 承诺签发时间");
    const counts = candidate.weekPaperCounts;
    if (!Number.isInteger(candidate.studentCount) || candidate.studentCount < 9 || candidate.studentCount > MAX_ITEMS ||
        candidate.paperCount !== candidate.studentCount || !Number.isInteger(candidate.weekCount) ||
        !Array.isArray(counts) || counts.length !== candidate.weekCount ||
        counts.some(function bad(value) { return value !== 3 && value !== 4; }) ||
        counts.reduce(function sum(total, value) { return total + value; }, 0) !== candidate.paperCount ||
        Math.max.apply(null, counts) * 3 > candidate.studentCount || candidate.studentsPerPaper !== 3 ||
        candidate.finalSelectionsPerStudent !== 3 || candidate.presentersPerPaper !== 1 ||
        candidate.finalPresentationsPerStudent !== 1) {
      fail("INVALID_RECEIPT", "v6 公开承诺凭证的数量或分周结构不正确。");
    }
    requireHex32(candidate.inputDigest, "INVALID_RECEIPT", "v6 输入摘要");
    requireHex32(candidate.commitment, "INVALID_RECEIPT", "v6 承诺码");
    return clone(candidate);
  }

  function confirmCommitmentV6(schedule, at) {
    inspectAudit(schedule);
    if (schedule.weeks.some(function revealed(week) { return week.revealed.some(Boolean); })) {
      fail("COMMITMENT_TOO_LATE", "必须在揭晓任何结果前确认已公开承诺。");
    }
    const confirmedAt = requireIso(at === undefined ? new Date().toISOString() : at, "INVALID_CONFIRMATION_TIME", "v6 承诺确认时间");
    if (Date.parse(confirmedAt) < Date.parse(schedule.createdAt)) fail("INVALID_CONFIRMATION_TIME", "v6 承诺确认时间不能早于安排创建时间。");
    if (schedule.audit.commitmentConfirmedAt && schedule.audit.commitmentConfirmedAt !== confirmedAt) {
      fail("COMMITMENT_ALREADY_CONFIRMED", "v6 承诺已经确认，不能改写确认时间。");
    }
    schedule.audit.commitmentConfirmedAt = confirmedAt;
    return schedule;
  }

  function createFinalReportV6(schedule, options) {
    const inspected = inspectAudit(schedule);
    if (!inspected.complete) fail("COURSE_INCOMPLETE", "全部论文揭晓后才能创建最终审计报告。");
    if (!schedule.audit.commitmentConfirmedAt) fail("COMMITMENT_NOT_CONFIRMED", "公开承诺尚未确认。");
    const completedAt = options && options.completedAt !== undefined
      ? requireIso(options.completedAt, "INVALID_COMPLETION_TIME", "v6 报告生成时间")
      : new Date().toISOString();
    if (Date.parse(completedAt) < Date.parse(schedule.audit.commitmentConfirmedAt)) {
      fail("INVALID_COMPLETION_TIME", "v6 报告生成时间不能早于承诺确认时间。");
    }
    return {
      format: REPORT_FORMAT,
      version: FORMAT_VERSION,
      completedAt: completedAt,
      receipt: createPublicReceiptV6(schedule),
      seed: schedule.audit.seedHex,
      students: inspected.input.students.slice(),
      courseWeeks: clone(inspected.input.courseWeeks),
      plan: clone(inspected.plan),
      planDigest: schedule.audit.planDigest,
    };
  }

  const REPORT_KEYS = ["format", "version", "completedAt", "receipt", "seed", "students", "courseWeeks", "plan", "planDigest"];

  function parseFinalReportV6(candidate) {
    exactKeys(candidate, REPORT_KEYS, "INVALID_REPORT", "v6 最终审计报告");
    if (candidate.format !== REPORT_FORMAT || candidate.version !== FORMAT_VERSION) {
      fail("INVALID_REPORT", "这不是受支持的 v6 论文提问抽签最终审计报告。");
    }
    requireIso(candidate.completedAt, "INVALID_REPORT", "v6 报告生成时间");
    const receipt = parsePublicReceiptV6(candidate.receipt);
    if (Date.parse(candidate.completedAt) < Date.parse(receipt.issuedAt)) fail("INVALID_REPORT", "v6 报告生成时间不能早于承诺签发时间。");
    requireHex32(candidate.seed, "INVALID_REPORT", "v6 报告随机种子");
    requireHex32(candidate.planDigest, "INVALID_REPORT", "v6 计划摘要");
    const input = canonicalizeInput(candidate.students, candidate.courseWeeks);
    if (!arraysEqual(input.students, candidate.students) || !courseWeeksEqual(input.courseWeeks, candidate.courseWeeks)) {
      fail("INVALID_REPORT", "v6 报告输入不是规范形。");
    }
    const sizes = input.courseWeeks.map(function size(week) { return week.papers.length; });
    if (receipt.studentCount !== input.students.length || receipt.paperCount !== input.students.length ||
        receipt.weekCount !== sizes.length || !arraysEqual(receipt.weekPaperCounts, sizes)) {
      fail("INVALID_REPORT", "v6 报告输入数量或分周结构与内嵌承诺凭证不一致。");
    }
    inspectPlan(candidate.plan, input.courseWeeks, input.students.length);
    return clone(candidate);
  }

  function verificationFailure(code, message) {
    return { ok: false, code: code, message: message };
  }

  function verifyReceiptAndReportV6(receiptCandidate, reportCandidate) {
    let receipt;
    let report;
    try {
      receipt = parsePublicReceiptV6(receiptCandidate);
      report = parseFinalReportV6(reportCandidate);
    } catch (error) {
      return verificationFailure(error && error.code ? error.code : "INVALID_AUDIT_FILE",
        error instanceof Error ? error.message : "v6 审计文件格式不正确。");
    }
    try {
      const receiptMatches = RECEIPT_KEYS.every(function sameReceiptField(key) {
        return key === "weekPaperCounts"
          ? arraysEqual(receipt.weekPaperCounts, report.receipt.weekPaperCounts)
          : receipt[key] === report.receipt[key];
      });
      const digest = inputDigest(report.students, report.courseWeeks);
      const inputDigestMatches = digest === receipt.inputDigest;
      const commitment = computeCommitment(report.students, report.courseWeeks, report.seed, receipt.issuedAt);
      const commitmentMatches = commitment === receipt.commitment;
      const input = canonicalizeInput(report.students, report.courseWeeks);
      const replayedPlan = makePlan(input, report.seed);
      const reportedPlanDigest = planDigest(report.plan, input.courseWeeks, input.students.length);
      const replayedPlanDigest = planDigest(replayedPlan, input.courseWeeks, input.students.length);
      const replayMatches = JSON.stringify(canonicalPlan(replayedPlan, input.courseWeeks, input.students.length)) ===
        JSON.stringify(canonicalPlan(report.plan, input.courseWeeks, input.students.length));
      const reportedPlanDigestMatches = reportedPlanDigest === report.planDigest;
      const replayPlanDigestMatches = replayedPlanDigest === report.planDigest;
      const ok = receiptMatches && inputDigestMatches && commitmentMatches && replayMatches &&
        reportedPlanDigestMatches && replayPlanDigestMatches;
      let code = "OK";
      let message = "审计通过：事前承诺、分周课程表、随机种子、提问人与报告人安排全部匹配。";
      if (!receiptMatches) { code = "RECEIPT_MISMATCH"; message = "外部承诺凭证与报告内凭证不一致。"; }
      else if (!inputDigestMatches) { code = "INPUT_DIGEST_MISMATCH"; message = "规范输入摘要不匹配。"; }
      else if (!commitmentMatches) { code = "COMMITMENT_MISMATCH"; message = "随机种子无法重现事前承诺。"; }
      else if (!reportedPlanDigestMatches) { code = "PLAN_DIGEST_MISMATCH"; message = "报告计划摘要不匹配。"; }
      else if (!replayMatches || !replayPlanDigestMatches) { code = "REPLAY_MISMATCH"; message = "随机种子重放的安排与报告不一致。"; }
      return {
        ok: ok,
        code: code,
        message: message,
        receiptMatches: receiptMatches,
        inputDigestMatches: inputDigestMatches,
        commitmentMatches: commitmentMatches,
        reportedPlanDigestMatches: reportedPlanDigestMatches,
        replayPlanDigestMatches: replayPlanDigestMatches,
        replayMatches: replayMatches,
        inputDigest: digest,
        commitment: commitment,
        planDigest: replayedPlanDigest,
        students: report.students.slice(),
        papers: input.courseWeeks.flatMap(function papers(week) { return week.papers; }),
        courseWeeks: clone(input.courseWeeks),
        replayedPlan: clone(replayedPlan),
      };
    } catch (error) {
      return verificationFailure(error && error.code ? error.code : "REPLAY_FAILED",
        error instanceof Error ? error.message : "v6 审计重放失败。");
    }
  }

  function isV6Schedule(schedule) {
    return Boolean(schedule && schedule.audit && schedule.audit.protocolId === PROTOCOL_ID);
  }

  function createPublicReceiptAny(schedule) {
    return isV6Schedule(schedule) ? createPublicReceiptV6(schedule) : Base.createPublicReceipt(schedule);
  }

  function confirmCommitmentAny(schedule, at) {
    return isV6Schedule(schedule) ? confirmCommitmentV6(schedule, at) : Base.confirmCommitment(schedule, at);
  }

  function createFinalReportAny(schedule, options) {
    return isV6Schedule(schedule) ? createFinalReportV6(schedule, options) : Base.createFinalReport(schedule, options);
  }

  function parsePublicReceiptAny(candidate) {
    if (candidate && candidate.version === FORMAT_VERSION) return parsePublicReceiptV6(candidate);
    if (candidate && (candidate.version === 4 || candidate.version === 5)) return Base.parsePublicReceipt(candidate);
    fail("UNSUPPORTED_VERSION", "公开承诺凭证版本不受支持。");
  }

  function parseFinalReportAny(candidate) {
    if (candidate && candidate.version === FORMAT_VERSION) return parseFinalReportV6(candidate);
    if (candidate && (candidate.version === 4 || candidate.version === 5)) return Base.parseFinalReport(candidate);
    fail("UNSUPPORTED_VERSION", "最终审计报告版本不受支持。");
  }

  function verifyReceiptAndReportAny(receipt, report) {
    const receiptVersion = receipt && receipt.version;
    const reportVersion = report && report.version;
    if (receiptVersion !== reportVersion) return verificationFailure("VERSION_MISMATCH", "公开承诺与最终报告不是同一协议版本。");
    if (receiptVersion === FORMAT_VERSION) return verifyReceiptAndReportV6(receipt, report);
    if (receiptVersion === 4 || receiptVersion === 5) return Base.verifyReceiptAndReport(receipt, report);
    return verificationFailure("UNSUPPORTED_VERSION", "公开承诺与最终报告的协议版本不受支持。");
  }

  function verifyFinalReportAny(report, receipt) {
    if (receipt === undefined) return verificationFailure("RECEIPT_REQUIRED", "必须同时提供事前保存的公开承诺凭证。");
    return verifyReceiptAndReportAny(receipt, report);
  }

  return {
    ALGORITHM_VERSION: PROTOCOL_ID,
    FORMAT_VERSION: FORMAT_VERSION,
    NORMALIZATION_ID: NORMALIZATION_ID,
    PROTOCOL_ID: PROTOCOL_ID,
    RECEIPT_FORMAT: RECEIPT_FORMAT,
    REPORT_FORMAT: REPORT_FORMAT,
    RNG_ID: RNG_ID,
    SCHEDULE_ID: SCHEDULE_ID,
    canonicalInput: canonicalInput,
    canonicalizeInput: canonicalizeInput,
    computeCommitment: computeCommitment,
    confirmCommitment: confirmCommitmentAny,
    createAuditedSchedule: createAuditedSchedule,
    createDeterministicSchedule: createDeterministicSchedule,
    createFinalReport: createFinalReportAny,
    createPrng: createPrng,
    createPublicReceipt: createPublicReceiptAny,
    generateSeed: Base.generateSeed,
    inputDigest: inputDigest,
    legacyV4: Base.legacyV4,
    legacyV5: Base,
    parseFinalReport: parseFinalReportAny,
    parsePublicReceipt: parsePublicReceiptAny,
    parseTextLines: Base.parseTextLines,
    planDigest: planDigest,
    sha256Hex: Base.sha256Hex,
    verifyFinalReport: verifyFinalReportAny,
    verifyReceiptAndReport: verifyReceiptAndReportAny,
  };
});
