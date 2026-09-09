(function attachLotteryCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LotteryCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLotteryCore() {
  "use strict";

  function shuffle(items, random) {
    const copy = items.slice();
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      const value = copy[index];
      copy[index] = copy[swapIndex];
      copy[swapIndex] = value;
    }
    return copy;
  }

  function browserRandom() {
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const value = new Uint32Array(1);
      crypto.getRandomValues(value);
      return value[0] / 4294967296;
    }
    throw new Error("当前浏览器不支持安全随机数，无法生成抽签安排。");
  }

  function createSchedule(studentNames, papers, random) {
    const randomSource = random || browserRandom;
    if (studentNames.length !== papers.length) {
      throw new Error("学生人数必须与论文数量一致。");
    }
    if (studentNames.length < 9 || studentNames.length % 3 !== 0) {
      throw new Error("人数必须不少于 9，且为 3 的倍数。");
    }

    const students = studentNames.map(function mapStudent(name, index) {
      return { id: "student-" + (index + 1), name: name };
    });
    const counts = Object.fromEntries(students.map(function initialCount(student) {
      return [student.id, 0];
    }));
    const weeks = [];

    for (let weekIndex = 0; weekIndex < papers.length / 3; weekIndex += 1) {
      const levels = Array.from(new Set(Object.values(counts))).sort(function sortNumbers(left, right) {
        return left - right;
      });
      const selected = [];

      for (const level of levels) {
        if (selected.length === 9) break;
        const selectedIds = new Set(selected.map(function selectedId(student) { return student.id; }));
        const candidates = shuffle(students.filter(function eligible(student) {
          return counts[student.id] === level && !selectedIds.has(student.id);
        }), randomSource);
        selected.push.apply(selected, candidates.slice(0, 9 - selected.length));
      }

      if (selected.length !== 9) {
        throw new Error("当前规则无法生成完整安排，请检查名单。");
      }

      const weeklyOrder = shuffle(selected, randomSource);
      const weeklyPapers = papers.slice(weekIndex * 3, weekIndex * 3 + 3);
      const assignments = weeklyPapers.map(function mapPaper(paper, paperIndex) {
        return {
          paper: paper,
          studentIds: weeklyOrder
            .slice(paperIndex * 3, paperIndex * 3 + 3)
            .map(function studentId(student) { return student.id; }),
        };
      });

      selected.forEach(function increaseCount(student) {
        counts[student.id] += 1;
      });
      weeks.push({
        id: "week-" + (weekIndex + 1),
        assignments: assignments,
        revealed: [false, false, false],
      });
    }

    if (Object.values(counts).some(function notBalanced(count) { return count !== 3; })) {
      throw new Error("未能生成次数完全均衡的安排。");
    }

    return { students: students, weeks: weeks, createdAt: new Date().toISOString() };
  }

  function countRevealedSelections(schedule) {
    const counts = Object.fromEntries(schedule.students.map(function initialCount(student) {
      return [student.id, 0];
    }));
    schedule.weeks.forEach(function countWeek(week) {
      week.assignments.forEach(function countAssignment(assignment, paperIndex) {
        if (!week.revealed[paperIndex]) return;
        assignment.studentIds.forEach(function countStudent(studentId) {
          counts[studentId] += 1;
        });
      });
    });
    return counts;
  }

  function countRevealedPresentations(schedule) {
    const counts = Object.fromEntries(schedule.students.map(function initialCount(student) {
      return [student.id, 0];
    }));
    schedule.weeks.forEach(function countWeek(week) {
      week.assignments.forEach(function countAssignment(assignment, paperIndex) {
        if (!week.revealed[paperIndex] || !Object.hasOwn(assignment, "presenterId")) return;
        if (Object.hasOwn(counts, assignment.presenterId)) counts[assignment.presenterId] += 1;
      });
    });
    return counts;
  }

  function verifyScheduleLegacy(candidate) {
    if (!candidate || typeof candidate !== "object") return false;
    const students = candidate.students;
    const weeks = candidate.weeks;
    if (
      !Array.isArray(students) ||
      students.length < 9 ||
      students.length % 3 !== 0 ||
      !Array.isArray(weeks) ||
      weeks.length !== students.length / 3 ||
      typeof candidate.createdAt !== "string"
    ) return false;

    const studentIds = new Set();
    for (const student of students) {
      if (!student || typeof student.id !== "string" || !student.id || typeof student.name !== "string" || !student.name.trim()) return false;
      if (studentIds.has(student.id)) return false;
      studentIds.add(student.id);
    }

    const totals = Object.fromEntries(students.map(function initialCount(student) { return [student.id, 0]; }));
    const paperNames = new Set();
    const weekIds = new Set();
    const presenterIds = [];
    let presenterMode = null;

    for (const week of weeks) {
      if (
        !week || typeof week.id !== "string" || !week.id || weekIds.has(week.id) ||
        !Array.isArray(week.assignments) || week.assignments.length !== 3 ||
        !Array.isArray(week.revealed) || week.revealed.length !== 3 ||
        week.revealed.some(function invalidReveal(value) { return typeof value !== "boolean"; })
      ) return false;
      weekIds.add(week.id);

      const weeklyIds = [];
      for (const assignment of week.assignments) {
        const hasPresenter = Object.hasOwn(assignment || {}, "presenterId");
        if (presenterMode === null) presenterMode = hasPresenter;
        if (presenterMode !== hasPresenter) return false;
        if (
          !assignment || typeof assignment.paper !== "string" || !assignment.paper.trim() || paperNames.has(assignment.paper) ||
          !Array.isArray(assignment.studentIds) || assignment.studentIds.length !== 3
        ) return false;
        paperNames.add(assignment.paper);
        for (const studentId of assignment.studentIds) {
          if (typeof studentId !== "string" || !Object.hasOwn(totals, studentId)) return false;
          weeklyIds.push(studentId);
          totals[studentId] += 1;
        }
        if (hasPresenter) {
          if (
            typeof assignment.presenterId !== "string" ||
            !Object.hasOwn(totals, assignment.presenterId) ||
            assignment.studentIds.includes(assignment.presenterId)
          ) return false;
          presenterIds.push(assignment.presenterId);
        }
      }
      if (weeklyIds.length !== 9 || new Set(weeklyIds).size !== 9) return false;
    }

    if (!Object.values(totals).every(function exactlyThree(count) { return count === 3; })) return false;
    return !presenterMode || (presenterIds.length === students.length && new Set(presenterIds).size === students.length);
  }

  function verifyScheduleV6(candidate) {
    if (!candidate || typeof candidate !== "object") return false;
    const students = candidate.students;
    const weeks = candidate.weeks;
    if (!Array.isArray(students) || students.length < 9 || !Array.isArray(weeks) || !weeks.length ||
        typeof candidate.createdAt !== "string") return false;

    const studentIds = new Set();
    for (const student of students) {
      if (!student || typeof student.id !== "string" || !student.id || typeof student.name !== "string" || !student.name.trim() ||
          studentIds.has(student.id)) return false;
      studentIds.add(student.id);
    }

    const totals = Object.fromEntries(students.map(function initialCount(student) { return [student.id, 0]; }));
    const presenterIds = [];
    const paperNames = new Set();
    const weekIds = new Set();
    let paperCount = 0;
    for (const week of weeks) {
      if (!week || typeof week.id !== "string" || !week.id || weekIds.has(week.id) ||
          typeof week.label !== "string" || !week.label.trim() ||
          !Array.isArray(week.assignments) || (week.assignments.length !== 3 && week.assignments.length !== 4) ||
          !Array.isArray(week.revealed) || week.revealed.length !== week.assignments.length ||
          week.revealed.some(function invalidReveal(value) { return typeof value !== "boolean"; })) return false;
      weekIds.add(week.id);
      const weeklyIds = [];
      for (const assignment of week.assignments) {
        if (!assignment || typeof assignment.paper !== "string" || !assignment.paper.trim() || paperNames.has(assignment.paper) ||
            !Array.isArray(assignment.studentIds) || assignment.studentIds.length !== 3 ||
            typeof assignment.presenterId !== "string" || !studentIds.has(assignment.presenterId) ||
            assignment.studentIds.includes(assignment.presenterId)) return false;
        paperNames.add(assignment.paper);
        paperCount += 1;
        for (const studentId of assignment.studentIds) {
          if (typeof studentId !== "string" || !Object.hasOwn(totals, studentId)) return false;
          weeklyIds.push(studentId);
          totals[studentId] += 1;
        }
        presenterIds.push(assignment.presenterId);
      }
      if (weeklyIds.length !== week.assignments.length * 3 || new Set(weeklyIds).size !== weeklyIds.length) return false;
    }

    return paperCount === students.length && Object.values(totals).every(function exactlyThree(count) { return count === 3; }) &&
      presenterIds.length === students.length && new Set(presenterIds).size === students.length;
  }

  function verifyScheduleV7(candidate) {
    if (!verifyScheduleV6(candidate)) return false;
    return candidate.weeks.every(function weeklyRolesAreDisjoint(week) {
      const questioners = new Set(week.assignments.flatMap(function questionerIds(assignment) {
        return assignment.studentIds;
      }));
      const presenters = week.assignments.map(function presenterId(assignment) {
        return assignment.presenterId;
      });
      return new Set(presenters).size === presenters.length &&
        presenters.every(function notQuestioningThisWeek(studentId) { return !questioners.has(studentId); });
    });
  }

  function verifySchedule(candidate) {
    if (candidate && Object.hasOwn(candidate, "audit")) {
      if (!candidate.audit || typeof candidate.audit !== "object") return false;
      const protocolId = candidate.audit.protocolId;
      if (protocolId === "paper-question-picker/v7") return verifyScheduleV7(candidate);
      if (protocolId === "paper-question-picker/v6") return verifyScheduleV6(candidate);
      if (protocolId === "paper-question-picker/v5" || protocolId === "paper-question-picker/v4") {
        return verifyScheduleLegacy(candidate);
      }
      return false;
    }
    const hasV6Shape = Boolean(candidate && Array.isArray(candidate.weeks) && candidate.weeks.length &&
      candidate.weeks.every(function labeledWeek(week) {
        return week && typeof week.label === "string" && week.label.trim();
      }));
    return hasV6Shape ? verifyScheduleV6(candidate) : verifyScheduleLegacy(candidate);
  }

  return {
    browserRandom: browserRandom,
    createSchedule: createSchedule,
    countRevealedPresentations: countRevealedPresentations,
    countRevealedSelections: countRevealedSelections,
    verifySchedule: verifySchedule,
  };
});
