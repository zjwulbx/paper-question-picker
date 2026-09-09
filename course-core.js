(function attachCourseCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CourseCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCourseCore() {
  "use strict";

  const TRIM_EDGES = /^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g;
  const ACTIVE_STATUSES = new Set(["", "正常", "有效"]);
  const CANCELLED_STATUS = "取消";

  function normalizeCell(value) {
    return String(value === undefined || value === null ? "" : value).normalize("NFC").replace(TRIM_EDGES, "");
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function same(value, index) {
      return value === right[index];
    });
  }

  // v1-v5 stored papers as one title per line. Accept that shape at the input
  // boundary and give it the historical three-papers-per-week grouping so an
  // old draft can be edited or regenerated without manual TSV conversion.
  function parseLegacyPaperList(value) {
    const source = String(value === undefined || value === null ? "" : value).replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
    const rows = [];
    const papers = [];
    source.split("\n").forEach(function legacyRow(rawLine, zeroIndex) {
      const title = normalizeCell(rawLine);
      if (!title) return;
      const label = "第 " + (Math.floor(papers.length / 3) + 1) + " 周";
      papers.push(title);
      rows.push({ lineNumber: zeroIndex + 1, label: label, paper: title, active: true });
    });
    const weeks = [];
    for (let index = 0; index < papers.length; index += 3) {
      weeks.push({ label: "第 " + (weeks.length + 1) + " 周", papers: papers.slice(index, index + 3) });
    }
    return { weeks: weeks, rows: rows, activePapers: papers, excludedRows: [], errors: [] };
  }

  function parseCourseTable(value) {
    const source = String(value === undefined || value === null ? "" : value).replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
    const weeks = [];
    const rows = [];
    const excludedRows = [];
    const errors = [];
    const seenLabels = new Set();
    let currentWeek = null;

    source.split("\n").forEach(function parseRow(rawLine, zeroIndex) {
      if (!rawLine.trim()) return;
      const lineNumber = zeroIndex + 1;
      const cells = rawLine.split("\t");
      if (cells.length < 2) {
        errors.push("课程表第 " + lineNumber + " 行缺少 Tab 分隔符；格式应为“周次/日期 Tab 论文标题 Tab 状态”。");
        return;
      }
      if (cells.length > 3 && cells.slice(3).some(function nonEmpty(cell) { return normalizeCell(cell); })) {
        errors.push("课程表第 " + lineNumber + " 行超过 3 列。");
        return;
      }
      const label = normalizeCell(cells[0]);
      const title = normalizeCell(cells[1]);
      const status = normalizeCell(cells[2]);
      if (!rows.length && !weeks.length && label === "周次/日期" && title === "论文标题" && (status === "" || status === "状态")) {
        return;
      }
      if (label) {
        if (!currentWeek || currentWeek.label !== label) {
          if (seenLabels.has(label)) {
            errors.push("周次“" + label + "”分散在多处；同一周的论文必须连续排列。");
            currentWeek = null;
            return;
          }
          currentWeek = { label: label, papers: [] };
          weeks.push(currentWeek);
          seenLabels.add(label);
        }
      }
      if (!currentWeek) {
        errors.push("课程表第 " + lineNumber + " 行没有周次；每组第一篇论文必须填写周次/日期。");
        return;
      }
      if (!title) {
        errors.push("课程表第 " + lineNumber + " 行缺少论文标题。");
        return;
      }
      if (!ACTIVE_STATUSES.has(status) && status !== CANCELLED_STATUS) {
        errors.push("课程表第 " + lineNumber + " 行状态只能留空、写“正常”“有效”或“取消”。");
        return;
      }
      const active = status !== CANCELLED_STATUS;
      const row = { lineNumber: lineNumber, label: currentWeek.label, paper: title, active: active };
      rows.push(row);
      if (active) currentWeek.papers.push(title);
      else excludedRows.push(row);
    });

    const activePapers = weeks.flatMap(function weekPapers(week) { return week.papers; });
    return {
      weeks: weeks,
      rows: rows,
      activePapers: activePapers,
      excludedRows: excludedRows,
      errors: errors,
    };
  }

  function parseCourseInput(value) {
    const source = String(value === undefined || value === null ? "" : value).replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
    const contentLines = source.split("\n").filter(function nonBlank(line) { return line.trim(); });
    if (contentLines.length && contentLines.every(function withoutTabs(line) { return !line.includes("\t"); })) {
      return parseLegacyPaperList(source);
    }
    return parseCourseTable(source);
  }

  function formatCourseTable(courseWeeks) {
    const lines = ["周次/日期\t论文标题\t状态"];
    (Array.isArray(courseWeeks) ? courseWeeks : []).forEach(function formatWeek(week) {
      if (!week || !Array.isArray(week.papers)) return;
      week.papers.forEach(function formatPaper(paper, index) {
        lines.push((index === 0 ? normalizeCell(week.label) : "") + "\t" + normalizeCell(paper) + "\t");
      });
    });
    return lines.join("\n");
  }

  function courseWeeksFromSchedule(schedule) {
    if (!schedule || !Array.isArray(schedule.weeks)) return [];
    return schedule.weeks.map(function scheduleWeek(week, index) {
      return {
        label: typeof week.label === "string" && week.label.trim() ? week.label : "第 " + (index + 1) + " 周",
        papers: Array.isArray(week.assignments)
          ? week.assignments.map(function paperTitle(assignment) { return assignment.paper; })
          : [],
      };
    });
  }

  function isStructuredSchedule(schedule) {
    return Boolean(schedule && Array.isArray(schedule.weeks) && schedule.weeks.length &&
      schedule.weeks.every(function labeled(week) { return typeof week.label === "string" && week.label.trim(); }));
  }

  function paperTextMatchesSchedule(text, schedule) {
    if (!isStructuredSchedule(schedule)) {
      const lines = String(text || "").split(/\r?\n/).map(normalizeCell).filter(Boolean);
      const papers = courseWeeksFromSchedule(schedule).flatMap(function weekPapers(week) { return week.papers; });
      return arraysEqual(lines, papers);
    }
    const parsed = parseCourseInput(text);
    if (parsed.errors.length) return false;
    const expected = courseWeeksFromSchedule(schedule);
    return parsed.weeks.length === expected.length && parsed.weeks.every(function sameWeek(week, index) {
      return week.label === expected[index].label && arraysEqual(week.papers, expected[index].papers);
    });
  }

  function paperTextForSchedule(schedule) {
    if (isStructuredSchedule(schedule)) return formatCourseTable(courseWeeksFromSchedule(schedule));
    return courseWeeksFromSchedule(schedule).flatMap(function weekPapers(week) { return week.papers; }).join("\n");
  }

  return {
    CANCELLED_STATUS: CANCELLED_STATUS,
    courseWeeksFromSchedule: courseWeeksFromSchedule,
    formatCourseTable: formatCourseTable,
    isStructuredSchedule: isStructuredSchedule,
    paperTextForSchedule: paperTextForSchedule,
    paperTextMatchesSchedule: paperTextMatchesSchedule,
    parseCourseInput: parseCourseInput,
    parseCourseTable: parseCourseTable,
  };
});
