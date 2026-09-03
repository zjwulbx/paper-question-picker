(function attachHistoryCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.HistoryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createHistoryCore() {
  "use strict";

  const SCHEMA_VERSION = 1;
  const MAX_SESSIONS = 20;
  const MAX_OPERATIONS = 400;

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

  function normalizeSessions(candidate, verifySchedule, now) {
    const fallbackNow = validIso(now, new Date().toISOString());
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
    }).slice(0, MAX_SESSIONS);
  }

  function mergeSessions(left, right, verifySchedule, now) {
    const combined = normalizeSessions(left, verifySchedule, now).concat(
      normalizeSessions(right, verifySchedule, now),
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
    }).slice(0, MAX_SESSIONS);
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
    const now = validIso(settings.now, new Date().toISOString());
    const normalized = normalizeSessions(sessions, verifySchedule, now);
    const requestedId = safeId(settings.sessionId);
    const existing = requestedId
      ? normalized.find(function sameSession(session) { return session.id === requestedId; })
      : null;
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
      })).slice(0, MAX_SESSIONS),
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

  return {
    MAX_SESSIONS: MAX_SESSIONS,
    SCHEMA_VERSION: SCHEMA_VERSION,
    clone: clone,
    getVisibleRows: getVisibleRows,
    mergeSessions: mergeSessions,
    normalizeSessions: normalizeSessions,
    upsertSession: upsertSession,
  };
});
