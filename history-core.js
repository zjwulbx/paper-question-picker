(function attachHistoryCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HistoryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createHistoryCore() {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MAX_SESSIONS = 20;
  const MAX_OPERATIONS = 400;
  const BACKUP_FORMAT = "paper-question-picker-backup";
  const BACKUP_VERSION = 1;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function parseLines(value) {
    return String(value || "").split(/\r?\n/).map(function trimLine(line) {
      return line.trim();
    }).filter(Boolean);
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function same(item, index) {
      return item === right[index];
    });
  }

  function validIso(value, fallback) {
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
      return new Date(value).toISOString();
    }
    return fallback;
  }

  function isCanonicalIso(value) {
    return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
  }

  function safeId(value) {
    return typeof value === "string" && /^[a-zA-Z0-9._:-]{1,120}$/.test(value) ? value : null;
  }

  function clampWeek(value, schedule) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(Math.max(Math.floor(parsed), 0), schedule.weeks.length - 1);
  }

  function scheduleNames(schedule) {
    return schedule.students.map(function getName(student) { return student.name; });
  }

  function schedulePapers(schedule) {
    return schedule.weeks.flatMap(function papersForWeek(week) {
      return week.assignments.map(function getPaper(assignment) { return assignment.paper; });
    });
  }

  function schedulePlanSignature(schedule) {
    if (!schedule || typeof schedule !== "object") return null;
    return JSON.stringify({
      createdAt: schedule.createdAt,
      students: Array.isArray(schedule.students) ? schedule.students.map(function studentRow(student) {
        return [student.id, student.name];
      }) : null,
      weeks: Array.isArray(schedule.weeks) ? schedule.weeks.map(function weekRow(week) {
        return [week.id, Array.isArray(week.assignments) ? week.assignments.map(function assignmentRow(assignment) {
          return [assignment.paper, assignment.studentIds];
        }) : null];
      }) : null,
    });
  }

  function sameSchedulePlan(left, right) {
    return schedulePlanSignature(left) === schedulePlanSignature(right);
  }

  function normalizeOperation(candidate, fallbackAt) {
    if (!candidate || typeof candidate !== "object") return null;
    const type = typeof candidate.type === "string" && /^[a-z-]{1,40}$/.test(candidate.type)
      ? candidate.type
      : null;
    const description = typeof candidate.description === "string"
      ? candidate.description.trim().slice(0, 600)
      : "";
    if (!type || !description) return null;
    return {
      type: type,
      description: description,
      at: validIso(candidate.at, fallbackAt),
    };
  }

  function normalizeSession(candidate, verifySchedule, fallbackNow) {
    if (!candidate || typeof candidate !== "object" || typeof verifySchedule !== "function") return null;
    const id = safeId(candidate.id);
    if (!id || !verifySchedule(candidate.schedule)) return null;

    const schedule = clone(candidate.schedule);
    const names = scheduleNames(schedule);
    const papers = schedulePapers(schedule);
    const candidateStudents = parseLines(candidate.studentText);
    const candidatePapers = parseLines(candidate.paperText);
    const createdAt = validIso(candidate.createdAt, validIso(schedule.createdAt, fallbackNow));
    const updatedAt = validIso(candidate.updatedAt, createdAt);
    const operations = Array.isArray(candidate.operations)
      ? candidate.operations.map(function normalize(item) {
          return normalizeOperation(item, updatedAt);
        }).filter(Boolean).slice(-MAX_OPERATIONS)
      : [];

    return {
      schemaVersion: SCHEMA_VERSION,
      id: id,
      createdAt: createdAt,
      updatedAt: updatedAt,
      studentText: arraysEqual(candidateStudents, names) ? candidate.studentText : names.join("\n"),
      paperText: arraysEqual(candidatePapers, papers) ? candidate.paperText : papers.join("\n"),
      schedule: schedule,
      activeWeek: clampWeek(candidate.activeWeek, schedule),
      operations: operations,
    };
  }

  function normalizeSessions(candidate, verifySchedule, now, limit) {
    const fallbackNow = validIso(now, new Date().toISOString());
    const sessionLimit = limit === Infinity
      ? Infinity
      : Number.isFinite(Number(limit)) && Number(limit) > 0
        ? Math.floor(Number(limit))
        : MAX_SESSIONS;
    const list = Array.isArray(candidate)
      ? candidate
      : candidate && candidate.schemaVersion === SCHEMA_VERSION && Array.isArray(candidate.sessions)
        ? candidate.sessions
        : [];
    const ids = new Set();
    return list.map(function normalize(item) {
      return normalizeSession(item, verifySchedule, fallbackNow);
    }).filter(function valid(session) {
      if (!session || ids.has(session.id)) return false;
      ids.add(session.id);
      return true;
    }).sort(function newestFirst(left, right) {
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    }).slice(0, sessionLimit);
  }

  function mergeSessions(left, right, verifySchedule, now, limit) {
    const sessionLimit = limit === Infinity ? Infinity : MAX_SESSIONS;
    const combined = normalizeSessions(left, verifySchedule, now, sessionLimit).concat(
      normalizeSessions(right, verifySchedule, now, sessionLimit),
    );
    const byId = new Map();
    combined.forEach(function chooseNewest(session) {
      const existing = byId.get(session.id);
      if (!existing || Date.parse(session.updatedAt) > Date.parse(existing.updatedAt)) {
        byId.set(session.id, session);
      }
    });
    return Array.from(byId.values()).sort(function newestFirst(first, second) {
      return Date.parse(second.updatedAt) - Date.parse(first.updatedAt);
    }).slice(0, sessionLimit);
  }

  function makeSessionId(now, random) {
    const randomSource = typeof random === "function" ? random : Math.random;
    const milliseconds = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
    const suffix = Math.floor(randomSource() * 0x100000000).toString(36).padStart(7, "0");
    return "session-" + milliseconds.toString(36) + "-" + suffix;
  }

  function upsertSession(sessions, snapshot, operation, verifySchedule, options) {
    if (!snapshot || !verifySchedule(snapshot.schedule)) {
      throw new Error("无法保存无效的抽签安排。");
    }
    const settings = options || {};
    const requestedNow = validIso(settings.now, new Date().toISOString());
    const sessionLimit = settings.limit === Infinity ? Infinity : MAX_SESSIONS;
    const normalized = normalizeSessions(sessions, verifySchedule, requestedNow, sessionLimit);
    const requestedId = safeId(settings.sessionId);
    const existing = requestedId
      ? normalized.find(function sameSession(session) { return session.id === requestedId; })
      : null;
    const latestTimestamp = Math.max(
      Date.parse(requestedNow),
      existing ? Date.parse(existing.updatedAt) : 0,
    );
    const now = new Date(latestTimestamp).toISOString();
    let sessionId = existing ? existing.id : makeSessionId(now, settings.random);
    if (!existing) {
      let collision = 1;
      const existingIds = new Set(normalized.map(function getId(session) { return session.id; }));
      const baseId = sessionId;
      while (existingIds.has(sessionId)) {
        sessionId = baseId + "-" + collision;
        collision += 1;
      }
    }
    const nextOperations = existing ? existing.operations.slice() : [];
    const nextOperation = operation ? normalizeOperation({
      type: operation.type,
      description: operation.description,
      at: operation.at || now,
    }, now) : null;
    if (nextOperation) nextOperations.push(nextOperation);

    const session = normalizeSession({
      schemaVersion: SCHEMA_VERSION,
      id: sessionId,
      createdAt: existing ? existing.createdAt : validIso(snapshot.schedule.createdAt, now),
      updatedAt: now,
      studentText: snapshot.studentText,
      paperText: snapshot.paperText,
      schedule: snapshot.schedule,
      activeWeek: snapshot.activeWeek,
      operations: nextOperations.slice(-MAX_OPERATIONS),
    }, verifySchedule, now);

    return {
      sessionId: sessionId,
      sessions: [session].concat(normalized.filter(function other(item) {
        return item.id !== sessionId;
      })).slice(0, sessionLimit),
    };
  }

  function getVisibleRows(schedule) {
    if (!schedule || !Array.isArray(schedule.students) || !Array.isArray(schedule.weeks)) return [];
    const names = Object.fromEntries(schedule.students.map(function nameEntry(student) {
      return [student.id, student.name];
    }));
    return schedule.weeks.flatMap(function rowsForWeek(week, weekIndex) {
      return week.assignments.flatMap(function rowForPaper(assignment, paperIndex) {
        if (!week.revealed[paperIndex]) return [];
        return [{
          week: weekIndex + 1,
          paper: assignment.paper,
          names: assignment.studentIds.map(function studentName(id) { return names[id]; }),
        }];
      });
    });
  }

  function normalizeCurrent(candidate, verifySchedule) {
    if (!candidate || typeof candidate !== "object") return null;
    const studentText = typeof candidate.studentText === "string" ? candidate.studentText : "";
    const paperText = typeof candidate.paperText === "string" ? candidate.paperText : "";
    if (candidate.schedule === null || candidate.schedule === undefined) {
      return {
        studentText: studentText,
        paperText: paperText,
        schedule: null,
        activeWeek: 0,
        sessionId: null,
      };
    }
    if (typeof verifySchedule !== "function" || !verifySchedule(candidate.schedule)) return null;

    const schedule = clone(candidate.schedule);
    const names = scheduleNames(schedule);
    const papers = schedulePapers(schedule);
    return {
      studentText: arraysEqual(parseLines(studentText), names) ? studentText : names.join("\n"),
      paperText: arraysEqual(parseLines(paperText), papers) ? paperText : papers.join("\n"),
      schedule: schedule,
      activeWeek: clampWeek(candidate.activeWeek, schedule),
      sessionId: safeId(candidate.sessionId),
    };
  }

  function parseHistoryPayload(candidate, verifySchedule, now) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      candidate.schemaVersion !== SCHEMA_VERSION ||
      !Array.isArray(candidate.sessions) ||
      typeof verifySchedule !== "function"
    ) {
      throw new Error("历史数据格式不正确。");
    }
    if (candidate.sessions.length > MAX_SESSIONS) {
      throw new Error("历史记录超过可导入的 20 次上限。");
    }

    const parsedAt = validIso(now, new Date().toISOString());
    const ids = new Set();
    return candidate.sessions.map(function parseSession(session) {
      if (
        !session ||
        typeof session !== "object" ||
        session.schemaVersion !== SCHEMA_VERSION ||
        !safeId(session.id) ||
        ids.has(session.id) ||
        !verifySchedule(session.schedule) ||
        typeof session.studentText !== "string" ||
        typeof session.paperText !== "string" ||
        !isCanonicalIso(session.createdAt) ||
        !isCanonicalIso(session.updatedAt) ||
        Date.parse(session.createdAt) > Date.parse(session.updatedAt) ||
        !isCanonicalIso(session.schedule.createdAt) ||
        Date.parse(session.schedule.createdAt) > Date.parse(session.createdAt) ||
        !Number.isInteger(session.activeWeek) ||
        session.activeWeek < 0 ||
        session.activeWeek >= session.schedule.weeks.length ||
        !Array.isArray(session.operations) ||
        session.operations.length > MAX_OPERATIONS
      ) {
        throw new Error("历史存档中包含损坏或重复的记录。");
      }

      const names = scheduleNames(session.schedule);
      const papers = schedulePapers(session.schedule);
      if (
        !arraysEqual(parseLines(session.studentText), names) ||
        !arraysEqual(parseLines(session.paperText), papers) ||
        session.operations.some(function invalidOperation(operation) {
          const normalized = normalizeOperation(operation, parsedAt);
          return !normalized || normalized.type !== operation.type ||
            normalized.description !== operation.description ||
            !isCanonicalIso(operation.at) ||
            Date.parse(operation.at) < Date.parse(session.createdAt) ||
            Date.parse(operation.at) > Date.parse(session.updatedAt);
        })
      ) {
        throw new Error("历史存档内容与抽签安排不一致。");
      }

      ids.add(session.id);
      return normalizeSession(session, verifySchedule, parsedAt);
    }).sort(function newestFirst(left, right) {
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
  }

  function parseCurrentState(candidate, verifySchedule) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      typeof candidate.studentText !== "string" ||
      typeof candidate.paperText !== "string" ||
      !Object.hasOwn(candidate, "schedule")
    ) {
      throw new Error("备份文件中的当前状态格式不正确。");
    }
    if (candidate.schedule === null) {
      if (candidate.activeWeek !== 0 || candidate.sessionId !== null) {
        throw new Error("备份文件中的当前状态格式不正确。");
      }
      return normalizeCurrent(candidate, verifySchedule);
    }
    if (
      typeof verifySchedule !== "function" ||
      !verifySchedule(candidate.schedule) ||
      !isCanonicalIso(candidate.schedule.createdAt) ||
      !Number.isInteger(candidate.activeWeek) ||
      candidate.activeWeek < 0 ||
      candidate.activeWeek >= candidate.schedule.weeks.length ||
      !(candidate.sessionId === null || safeId(candidate.sessionId)) ||
      !arraysEqual(parseLines(candidate.studentText), scheduleNames(candidate.schedule)) ||
      !arraysEqual(parseLines(candidate.paperText), schedulePapers(candidate.schedule))
    ) {
      throw new Error("备份文件中的当前进度已经损坏。");
    }
    return normalizeCurrent(candidate, verifySchedule);
  }

  function createBackup(current, sessions, verifySchedule, now) {
    const exportedAt = validIso(now, new Date().toISOString());
    const candidateCurrent = current || {
      studentText: "",
      paperText: "",
      schedule: null,
      activeWeek: 0,
      sessionId: null,
    };
    const sourceSessions = Array.isArray(sessions)
      ? sessions
      : sessions && Array.isArray(sessions.sessions)
        ? sessions.sessions
        : [];
    const envelope = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: exportedAt,
      current: clone(candidateCurrent),
      history: {
        schemaVersion: SCHEMA_VERSION,
        sessions: clone(sourceSessions),
      },
    };
    const checked = parseBackup(envelope, verifySchedule, exportedAt);
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: exportedAt,
      current: checked.current,
      history: {
        schemaVersion: SCHEMA_VERSION,
        sessions: checked.sessions,
      },
    };
  }

  function parseBackup(candidate, verifySchedule, now) {
    if (!candidate || typeof candidate !== "object" || candidate.format !== BACKUP_FORMAT) {
      throw new Error("这不是论文提问抽签的完整备份文件。");
    }
    if (candidate.version !== BACKUP_VERSION) {
      throw new Error("备份文件版本不受支持，请确认导入网站与备份文件版本匹配。");
    }
    if (!isCanonicalIso(candidate.exportedAt)) {
      throw new Error("备份文件的导出时间无效。");
    }
    const parsedAt = validIso(now, new Date().toISOString());
    const current = parseCurrentState(candidate.current, verifySchedule);
    const sessions = parseHistoryPayload(candidate.history, verifySchedule, parsedAt);
    const exportedMilliseconds = Date.parse(candidate.exportedAt);
    if (
      (current.schedule && Date.parse(current.schedule.createdAt) > exportedMilliseconds) ||
      sessions.some(function afterExport(session) {
        return Date.parse(session.createdAt) > exportedMilliseconds ||
          Date.parse(session.updatedAt) > exportedMilliseconds ||
          Date.parse(session.schedule.createdAt) > exportedMilliseconds ||
          session.operations.some(function operationAfterExport(operation) {
            return Date.parse(operation.at) > exportedMilliseconds;
          });
      })
    ) {
      throw new Error("备份文件中包含晚于导出时间的记录。");
    }
    if (
      current.sessionId &&
      !sessions.some(function sameSession(session) {
        return session.id === current.sessionId && sameSchedulePlan(session.schedule, current.schedule);
      })
    ) {
      throw new Error("备份中的当前进度与对应历史存档不一致。");
    }
    if (!current.schedule && !current.studentText.trim() && !current.paperText.trim() && !sessions.length) {
      throw new Error("备份文件中没有可导入的数据。");
    }

    return {
      current: current,
      sessions: sessions,
      exportedAt: candidate.exportedAt,
    };
  }

  return {
    BACKUP_FORMAT: BACKUP_FORMAT,
    BACKUP_VERSION: BACKUP_VERSION,
    MAX_SESSIONS: MAX_SESSIONS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    clone: clone,
    createBackup: createBackup,
    getVisibleRows: getVisibleRows,
    mergeSessions: mergeSessions,
    normalizeSessions: normalizeSessions,
    parseBackup: parseBackup,
    parseHistoryPayload: parseHistoryPayload,
    sameSchedulePlan: sameSchedulePlan,
    upsertSession: upsertSession,
  };
});
