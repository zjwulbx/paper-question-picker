(function runApplication() {
  "use strict";

  const Core = globalThis.LotteryCore;
  const History = globalThis.HistoryCore;
  const Audit = globalThis.AuditCore;
  const Course = globalThis.CourseCore;
  const STORAGE_KEY = "paper-question-picker-web-v6";
  const HISTORY_STORAGE_KEY = "paper-question-picker-history-v6";
  const PREVIOUS_STORAGE_KEY = "paper-question-picker-web-v5";
  const PREVIOUS_HISTORY_STORAGE_KEY = "paper-question-picker-history-v5";
  const V4_STORAGE_KEY = "paper-question-picker-web-v4";
  const V4_HISTORY_STORAGE_KEY = "paper-question-picker-history-v4";
  const LEGACY_STORAGE_KEY = "paper-question-picker-web-v1";
  const LEGACY_HISTORY_STORAGE_KEY = "paper-question-picker-history-v1";
  const QUARANTINE_STORAGE_KEY = "paper-question-picker-unreadable-v6";
  const HISTORY_QUARANTINE_KEY = "paper-question-picker-unreadable-history-v6";
  const MAX_BACKUP_FILE_BYTES = 64 * 1024 * 1024;
  const MAX_AUDIT_FILE_BYTES = 64 * 1024 * 1024;
  const EXAMPLE_STUDENTS = Array.from({ length: 12 }, function anonymousStudent(_value, index) {
    return "示例学生" + String(index + 1).padStart(2, "0");
  }).join("\n");
  const EXAMPLE_COURSE = [
    "周次/日期\t论文标题\t状态",
    "第 1 周\t大语言模型的涌现能力\t", "\t检索增强生成方法\t", "\t多智能体协作机制\t",
    "第 2 周\t思维链提示的可靠性\t", "\t小样本学习的新进展\t", "\t模型对齐与人类反馈\t",
    "第 3 周\t知识蒸馏的实践路径\t", "\t长上下文建模方法\t", "\t视觉语言模型评测\t",
    "第 4 周\t智能体工具使用能力\t", "\t合成数据与模型训练\t", "\t可解释人工智能研究\t",
  ].join("\n");

  const elements = {
    studentsInput: document.querySelector("#students-input"),
    papersInput: document.querySelector("#papers-input"),
    coursePreview: document.querySelector("#course-preview"),
    coursePreviewSummary: document.querySelector("#course-preview-summary"),
    coursePreviewList: document.querySelector("#course-preview-list"),
    studentCount: document.querySelector("#student-count"),
    paperCount: document.querySelector("#paper-count"),
    metricStudents: document.querySelector("#metric-students"),
    metricPapers: document.querySelector("#metric-papers"),
    metricWeeks: document.querySelector("#metric-weeks"),
    settingsSubtitle: document.querySelector("#settings-subtitle"),
    settingsBadge: document.querySelector("#settings-badge"),
    validationBox: document.querySelector("#validation-box"),
    generateButton: document.querySelector("#generate-button"),
    editButton: document.querySelector("#edit-button"),
    inputActions: document.querySelector("#input-actions"),
    exampleButton: document.querySelector("#example-button"),
    clearButton: document.querySelector("#clear-button"),
    resetTop: document.querySelector("#reset-top"),
    saveNote: document.querySelector("#save-note"),
    stage: document.querySelector("#stage"),
    commitmentSection: document.querySelector("#commitment-section"),
    commitmentBadge: document.querySelector("#commitment-badge"),
    commitmentCode: document.querySelector("#commitment-code"),
    commitmentInputSummary: document.querySelector("#commitment-input-summary"),
    copyCommitmentButton: document.querySelector("#copy-commitment-button"),
    exportCommitmentButton: document.querySelector("#export-commitment-button"),
    confirmPublishedButton: document.querySelector("#confirm-published-button"),
    auditPanel: document.querySelector("#audit-panel"),
    auditSeed: document.querySelector("#audit-seed"),
    exportAuditButton: document.querySelector("#export-audit-button"),
    archiveSection: document.querySelector("#archive-section"),
    archiveCount: document.querySelector("#archive-count"),
    archiveList: document.querySelector("#archive-list"),
    backupExportButton: document.querySelector("#backup-export-button"),
    backupImportButton: document.querySelector("#backup-import-button"),
    backupFileInput: document.querySelector("#backup-file-input"),
    historySection: document.querySelector("#history-section"),
    historyContent: document.querySelector("#history-content"),
    statsSection: document.querySelector("#stats-section"),
    statsGrid: document.querySelector("#stats-grid"),
    courseProgressCount: document.querySelector("#course-progress-count"),
    courseProgressPercent: document.querySelector("#course-progress-percent"),
    courseProgressBar: document.querySelector("#course-progress-bar"),
    copyButton: document.querySelector("#copy-button"),
    exportButton: document.querySelector("#export-button"),
    liveStatus: document.querySelector("#live-status"),
    visibleStatus: document.querySelector("#visible-status"),
    visibleStatusText: document.querySelector("#visible-status-text"),
  };

  const state = {
    schedule: null,
    activeWeek: 0,
    revealing: null,
    timer: null,
    generating: false,
    importing: false,
    importToken: null,
    sessionId: null,
    archives: [],
    storageWriteBlocked: false,
    blockedCurrentRaw: null,
    historyWriteBlocked: false,
    blockedHistoryRaw: null,
    blockedHistorySources: [],
  };

  function parseLines(value) {
    return Audit.parseTextLines(String(value));
  }

  // v1-v3 used JavaScript trim without Unicode normalization. Keep that exact
  // behavior when checking an old saved schedule so migration never changes a
  // decomposed name such as "Cafe\u0301" behind the user's back.
  function parseLegacyLines(value) {
    return String(value || "").split(/\r?\n/).map(function trimLegacyLine(line) {
      return line.trim();
    }).filter(Boolean);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function findDuplicates(items) {
    const seen = new Set();
    const duplicates = new Set();
    items.forEach(function inspect(item) {
      if (seen.has(item)) duplicates.add(item);
      seen.add(item);
    });
    return Array.from(duplicates);
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function same(item, index) { return item === right[index]; });
  }

  function verifyStoredSchedule(candidate) {
    if (!Core.verifySchedule(candidate)) return false;
    // Historical v1-v3 schedules had neither audit data nor week labels. A
    // labeled v6-shaped schedule without its audit block is only a deterministic
    // test artifact and must not enter private backups as an unverifiable draw.
    if (!candidate.audit) return !Course.isStructuredSchedule(candidate);
    try {
      Audit.createPublicReceipt(candidate);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function validation() {
    let students = [];
    let papers = [];
    let courseWeeks = [];
    let courseRows = [];
    let excludedRows = [];
    const errors = [];
    try {
      students = parseLines(elements.studentsInput.value);
    } catch (error) {
      errors.push(error instanceof Error ? "学生名单：" + error.message : "学生名单包含无法处理的字符。");
    }
    const parsedCourse = Course.parseCourseInput(elements.papersInput.value);
    courseWeeks = parsedCourse.weeks;
    courseRows = parsedCourse.rows;
    papers = parsedCourse.activePapers;
    excludedRows = parsedCourse.excludedRows;
    errors.push.apply(errors, parsedCourse.errors);
    const duplicateStudents = findDuplicates(students);
    const duplicatePapers = findDuplicates(papers);
    if (students.length < 9) errors.push("至少需要 9 名学生。");
    if (papers.length !== students.length) {
      errors.push("论文数需与学生数一致：当前 " + students.length + " 名学生、" + papers.length + " 篇论文。");
    }
    if (duplicateStudents.length) errors.push("学生名单有重名：" + duplicateStudents.join("、") + "。请增加标识以便区分。");
    if (duplicatePapers.length) errors.push("论文列表有重复项：" + duplicatePapers.join("、") + "。");
    courseWeeks.forEach(function validateWeek(week) {
      if (week.papers.length !== 3 && week.papers.length !== 4) {
        errors.push(week.label + "有 " + week.papers.length + " 篇有效论文；每周必须恰好为 3 或 4 篇。");
      }
      if (week.papers.length * 3 > students.length) {
        errors.push(week.label + "需要 " + (week.papers.length * 3) + " 位互不重复的提问人，当前学生不足。");
      }
    });
    if (!errors.length) {
      try {
        const canonical = Audit.canonicalizeInput(students, courseWeeks);
        students = canonical.students;
        courseWeeks = canonical.courseWeeks;
        papers = courseWeeks.flatMap(function activePapers(week) { return week.papers; });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "输入不符合可验证抽签协议。");
      }
    }
    return {
      students: students,
      papers: papers,
      courseWeeks: courseWeeks,
      courseRows: courseRows,
      excludedRows: excludedRows,
      errors: errors,
    };
  }

  function setStatus(message) {
    elements.liveStatus.textContent = "";
    window.setTimeout(function announce() { elements.liveStatus.textContent = message; }, 10);
    elements.visibleStatusText.textContent = message;
    elements.visibleStatus.hidden = !message;
  }

  function saveState() {
    if (state.storageWriteBlocked) return false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        appVersion: 6,
        scheduleKind: scheduleKindForSchedule(state.schedule),
        studentText: elements.studentsInput.value,
        paperText: elements.papersInput.value,
        schedule: state.schedule,
        activeWeek: state.activeWeek,
        sessionId: state.sessionId,
      }));
      state.blockedCurrentRaw = null;
      return true;
    } catch (_error) {
      setStatus("系统无法保存本地进度；本次打开期间仍可正常使用。");
      return false;
    }
  }

  function currentSnapshot() {
    return {
      studentText: elements.studentsInput.value,
      paperText: elements.papersInput.value,
      schedule: state.schedule,
      activeWeek: state.activeWeek,
      sessionId: state.sessionId,
    };
  }

  function preserveUnreadableCurrent() {
    if (!state.storageWriteBlocked) return true;
    try {
      if (state.blockedCurrentRaw !== null) {
        localStorage.setItem(QUARANTINE_STORAGE_KEY, state.blockedCurrentRaw);
      }
      state.storageWriteBlocked = false;
      state.blockedCurrentRaw = null;
      return true;
    } catch (_error) {
      setStatus("旧的本机进度无法读取，也无法安全另存；为避免覆盖，操作已取消。请先导出浏览器网站数据。");
      return false;
    }
  }

  function preserveUnreadableHistory() {
    if (!state.historyWriteBlocked) return true;
    try {
      const sources = state.blockedHistorySources.slice();
      const previousQuarantine = localStorage.getItem(HISTORY_QUARANTINE_KEY);
      const currentSource = sources.find(function findCurrent(source) {
        return source.key === HISTORY_STORAGE_KEY;
      });
      const previousSource = sources.find(function findPrevious(source) {
        return source.key === PREVIOUS_HISTORY_STORAGE_KEY;
      });
      const v4Source = sources.find(function findV4(source) {
        return source.key === V4_HISTORY_STORAGE_KEY;
      });
      const legacySource = sources.find(function findLegacy(source) {
        return source.key === LEGACY_HISTORY_STORAGE_KEY;
      });
      const quarantine = JSON.stringify({
        format: "paper-question-picker-unreadable-history",
        version: 1,
        capturedAt: new Date().toISOString(),
        current: currentSource ? currentSource.raw : null,
        previous: previousSource ? previousSource.raw : null,
        v4: v4Source ? v4Source.raw : null,
        legacy: legacySource ? legacySource.raw : null,
        sources: sources,
        previousQuarantine: previousQuarantine,
      });
      localStorage.setItem(HISTORY_QUARANTINE_KEY, quarantine);

      // Only remove the exact unreadable value that was quarantined. If another
      // tab replaced it meanwhile, leave that newer value untouched.
      sources.forEach(function removeQuarantinedSource(source) {
        if (source.raw !== null && localStorage.getItem(source.key) === source.raw) {
          localStorage.removeItem(source.key);
        }
      });
      state.historyWriteBlocked = false;
      state.blockedHistoryRaw = null;
      state.blockedHistorySources = [];

      try {
        state.archives = History.mergeSessions(
          state.archives,
          readArchivesFromStorage(),
          verifyStoredSchedule,
        );
      } catch (error) {
        captureHistoryFailure(error);
        setStatus("历史存档在隔离期间又发生变化，操作已取消；原始数据仍未被覆盖。");
        return false;
      }
      return true;
    } catch (_error) {
      setStatus("旧的历史存档无法读取，也无法安全另存；为避免覆盖，操作已取消。请先导出浏览器网站数据。");
      return false;
    }
  }

  function historySource(key) {
    let raw = null;
    try {
      raw = localStorage.getItem(key);
      if (raw === null) return { sessions: [], failure: null, raw: raw };
      return {
        sessions: History.parseHistoryPayload(JSON.parse(raw), verifyStoredSchedule),
        failure: null,
        raw: raw,
      };
    } catch (_error) {
      return {
        sessions: [],
        failure: { key: key, raw: raw },
      };
    }
  }

  function readArchivesFromStorage() {
    const current = historySource(HISTORY_STORAGE_KEY);
    const previous = historySource(PREVIOUS_HISTORY_STORAGE_KEY);
    const v4 = historySource(V4_HISTORY_STORAGE_KEY);
    const legacy = historySource(LEGACY_HISTORY_STORAGE_KEY);
    let sessions = current.sessions;
    const failures = [current.failure, previous.failure, v4.failure, legacy.failure].filter(Boolean);
    [
      { key: PREVIOUS_HISTORY_STORAGE_KEY, source: previous },
      { key: V4_HISTORY_STORAGE_KEY, source: v4 },
      { key: LEGACY_HISTORY_STORAGE_KEY, source: legacy },
    ].forEach(function mergeOlder(entry) {
      const conflictingIds = new Set(entry.source.sessions.filter(function conflictsWithNewer(olderSession) {
        const newerSession = sessions.find(function sameId(candidate) { return candidate.id === olderSession.id; });
        return newerSession && !History.sameSchedulePlan(newerSession.schedule, olderSession.schedule);
      }).map(function conflictId(session) { return session.id; }));
      const mergeable = entry.source.sessions.filter(function noConflict(session) {
        return !conflictingIds.has(session.id);
      });
      sessions = History.mergeSessions(sessions, mergeable, verifyStoredSchedule);
      if (conflictingIds.size && !entry.source.failure) {
        failures.push({ key: entry.key, raw: entry.source.raw });
      }
    });
    if (failures.length) {
      const error = new Error("本机历史存档已经损坏。");
      error.validSessions = sessions;
      error.failures = failures;
      throw error;
    }
    return sessions;
  }

  function captureHistoryFailure(error) {
    const validSessions = error && Array.isArray(error.validSessions) ? error.validSessions : [];
    state.archives = History.mergeSessions(state.archives, validSessions, verifyStoredSchedule);
    const incoming = error && Array.isArray(error.failures) ? error.failures : [];
    const byKey = new Map(state.blockedHistorySources.map(function sourceEntry(source) {
      return [source.key, source];
    }));
    incoming.forEach(function remember(source) { byKey.set(source.key, source); });
    state.blockedHistorySources = Array.from(byKey.values());
    state.historyWriteBlocked = true;
    state.blockedHistoryRaw = JSON.stringify({
      current: state.blockedHistorySources.find(function currentSource(source) {
        return source.key === HISTORY_STORAGE_KEY;
      }) || null,
      previous: state.blockedHistorySources.find(function previousSource(source) {
        return source.key === PREVIOUS_HISTORY_STORAGE_KEY;
      }) || null,
      v4: state.blockedHistorySources.find(function v4Source(source) {
        return source.key === V4_HISTORY_STORAGE_KEY;
      }) || null,
      legacy: state.blockedHistorySources.find(function legacySource(source) {
        return source.key === LEGACY_HISTORY_STORAGE_KEY;
      }) || null,
    });
  }

  function loadArchives() {
    try {
      state.archives = readArchivesFromStorage();
    } catch (error) {
      captureHistoryFailure(error);
      setStatus("历史存档无法安全读取，系统已停止覆盖它；当前抽签进度未受影响。");
    }
  }

  function persistArchives(candidateSessions) {
    if (state.historyWriteBlocked) return false;
    const normalized = History.normalizeSessions(candidateSessions, verifyStoredSchedule);
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({
        schemaVersion: History.SCHEMA_VERSION,
        sessions: normalized,
      }));
      state.archives = normalized;
      return true;
    } catch (_error) {
      return false;
    }
  }

  function recordHistory(type, description) {
    if (!state.schedule) return false;
    try {
      const merged = History.mergeSessions(state.archives, readArchivesFromStorage(), verifyStoredSchedule);
      const update = History.upsertSession(merged, currentSnapshot(), type && description ? {
        type: type,
        description: description,
      } : null, verifyStoredSchedule, { sessionId: state.sessionId });
      if (!persistArchives(update.sessions)) {
        setStatus("历史存档写入失败，请先导出当前结果或释放浏览器存储空间。");
        return false;
      }
      state.sessionId = update.sessionId;
      const savedSession = update.sessions.find(function currentSession(session) {
        return session.id === update.sessionId;
      });
      if (savedSession && History.sameSchedulePlan(savedSession.schedule, state.schedule)) {
        state.schedule = History.clone(savedSession.schedule);
      }
      return true;
    } catch (_error) {
      setStatus("历史存档写入失败，当前抽签进度仍然保留。");
      return false;
    }
  }

  function ensureCurrentArchive() {
    if (!state.schedule) return;
    let matchingSession = state.sessionId ? state.archives.find(function sameSession(session) {
      return session.id === state.sessionId && History.sameSchedulePlan(session.schedule, state.schedule);
    }) : null;
    if (!matchingSession) {
      matchingSession = state.archives.find(function samePlan(session) {
        return History.sameSchedulePlan(session.schedule, state.schedule);
      });
    }
    const hasSession = Boolean(matchingSession);
    state.sessionId = matchingSession ? matchingSession.id : null;
    const description = hasSession ? null : "已自动保存原有抽签进度";
    if (recordHistory(description ? "migrate" : null, description)) saveState();
  }

  function loadState() {
    elements.studentsInput.value = "";
    elements.papersInput.value = "";
    let raw = null;
    try {
      let sourceVersion = 6;
      raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        sourceVersion = 5;
        raw = localStorage.getItem(PREVIOUS_STORAGE_KEY);
      }
      if (raw === null) {
        sourceVersion = 4;
        raw = localStorage.getItem(V4_STORAGE_KEY);
      }
      if (raw === null) {
        sourceVersion = 1;
        raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      }
      if (raw === null) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") throw new Error("当前进度格式不正确。");
      if (sourceVersion === 6 && saved.appVersion !== 6) throw new Error("当前进度版本不受支持。");
      if (sourceVersion === 5 && saved.appVersion !== 5) throw new Error("当前进度版本不受支持。");
      if (sourceVersion === 4 && saved.appVersion !== 4) throw new Error("旧版当前进度版本不受支持。");
      const studentText = typeof saved.studentText === "string" ? saved.studentText : "";
      const paperText = typeof saved.paperText === "string" ? saved.paperText : "";
      elements.studentsInput.value = studentText;
      elements.papersInput.value = paperText;
      if (saved.schedule === null || saved.schedule === undefined) {
        if (sourceVersion !== 1 && saved.scheduleKind !== "none") throw new Error("空进度类型标记不正确。");
        return;
      }
      if (sourceVersion !== 1) {
        const expectedKind = scheduleKindForSchedule(saved.schedule);
        if (saved.scheduleKind !== expectedKind) throw new Error("当前进度类型与抽签数据不一致。");
      }
      if (!verifyStoredSchedule(saved.schedule)) throw new Error("当前抽签安排或审计数据已经损坏。");
      const names = saved.schedule.students.map(function getName(student) { return student.name; });
      const savedLineParser = sourceVersion === 1 || saved.scheduleKind === "legacy-v3"
        ? parseLegacyLines
        : parseLines;
      const paperTextMatches = saved.scheduleKind === "audited-v6"
        ? Course.paperTextMatchesSchedule(paperText, saved.schedule)
        : arraysEqual(savedLineParser(paperText), saved.schedule.weeks.flatMap(function getPapers(week) {
            return week.assignments.map(function getPaper(assignment) { return assignment.paper; });
          }));
      if (!arraysEqual(savedLineParser(studentText), names) || !paperTextMatches) {
        throw new Error("保存的输入与抽签安排不一致。");
      }
      state.schedule = saved.schedule;
      const restoredWeek = Number(saved.activeWeek);
      state.activeWeek = Number.isFinite(restoredWeek)
        ? Math.min(Math.max(Math.floor(restoredWeek), 0), saved.schedule.weeks.length - 1)
        : 0;
      state.sessionId = typeof saved.sessionId === "string" ? saved.sessionId : null;
    } catch (_error) {
      state.storageWriteBlocked = true;
      state.blockedCurrentRaw = raw;
      setStatus("之前保存的当前进度无法安全读取，系统已停止覆盖它；历史存档仍可查看和导出。");
    }
  }

  function refreshInputs(skipSave) {
    const lockedCourse = state.schedule ? Course.parseCourseInput(elements.papersInput.value) : null;
    const result = state.schedule
      ? {
          students: state.schedule.students.map(function name(student) { return student.name; }),
          courseWeeks: Course.courseWeeksFromSchedule(state.schedule),
          papers: state.schedule.weeks.flatMap(function papers(week) {
            return week.assignments.map(function paper(assignment) { return assignment.paper; });
          }),
          courseRows: lockedCourse && !lockedCourse.errors.length ? lockedCourse.rows : [],
          excludedRows: lockedCourse && !lockedCourse.errors.length ? lockedCourse.excludedRows : [],
          errors: [],
        }
      : validation();
    elements.studentCount.textContent = result.students.length + " 人";
    elements.paperCount.textContent = result.papers.length + " 篇有效" +
      (result.excludedRows.length ? " · " + result.excludedRows.length + " 篇取消" : "");
    elements.metricStudents.textContent = result.students.length;
    elements.metricPapers.textContent = result.papers.length;
    elements.metricWeeks.textContent = result.courseWeeks.length || "—";
    elements.coursePreviewSummary.textContent = result.courseWeeks.length
      ? result.courseWeeks.length + " 周 · " + result.papers.length + " 篇有效" +
        (result.excludedRows.length ? " · 排除 " + result.excludedRows.length + " 篇" : "")
      : "等待读取课程表";
    elements.coursePreviewList.innerHTML = result.courseWeeks.length
      ? result.courseWeeks.map(function previewWeek(week) {
          const sourceRows = result.courseRows.filter(function sameWeek(row) { return row.label === week.label; });
          const previewRows = sourceRows.length
            ? sourceRows
            : week.papers.map(function activeRow(paper) { return { paper: paper, active: true }; });
          return `<section class="course-preview-week"><strong>${escapeHtml(week.label)}</strong><span>${week.papers.length} 篇有效</span>` +
            `<ol>${previewRows.map(function previewPaper(row) {
              return row.active
                ? `<li>${escapeHtml(row.paper)}</li>`
                : `<li class="cancelled-row"><s>${escapeHtml(row.paper)}</s><em>取消</em></li>`;
            }).join("")}` +
            `</ol></section>`;
        }).join("")
      : '<p class="empty-operation">请按三列课程表格式粘贴。</p>';
    elements.backupExportButton.disabled = state.importing || (state.archives.length === 0 && !state.schedule &&
      !elements.studentsInput.value.trim() && !elements.papersInput.value.trim());
    elements.backupImportButton.disabled = state.importing;

    if (!state.schedule) {
      const valid = result.errors.length === 0;
      elements.settingsBadge.className = "badge " + (valid ? "success" : "danger");
      elements.settingsBadge.textContent = valid ? "✓ 可开始" : "! 待完善";
      elements.generateButton.disabled = !valid || state.importing || state.generating;
      elements.validationBox.hidden = valid;
      elements.validationBox.innerHTML = valid
        ? ""
        : "<strong>还不能开始抽签</strong><ul>" + result.errors.map(function errorItem(error) {
            return "<li>" + escapeHtml(error) + "</li>";
          }).join("") + "</ul>";
    }
    if (!skipSave) saveState();
  }

  function setLocked(locked) {
    const busy = state.importing || state.generating;
    elements.studentsInput.disabled = locked || busy;
    elements.papersInput.disabled = locked || busy;
    elements.generateButton.hidden = locked;
    elements.editButton.hidden = !locked;
    elements.editButton.disabled = busy;
    elements.inputActions.hidden = locked;
    elements.exampleButton.disabled = busy;
    elements.clearButton.disabled = busy;
    elements.resetTop.disabled = !locked || busy;
    elements.validationBox.hidden = locked || validation().errors.length === 0;
    elements.settingsSubtitle.textContent = locked ? "本次名单与分周课程表已锁定" : "学生逐行填写；课程表按周次、论文和状态粘贴";
    elements.settingsBadge.className = "badge " + (locked ? "neutral" : "success");
    elements.settingsBadge.textContent = locked ? "▣ 已锁定" : "✓ 可开始";
    elements.saveNote.textContent = locked
      ? "抽签结果与进度已自动保存在这台电脑。"
      : "学生名单与论文安排只保存在当前浏览器及你导出的私密备份中，不会上传。";
  }

  function getNameMap() {
    if (!state.schedule) return {};
    return Object.fromEntries(state.schedule.students.map(function nameEntry(student) {
      return [student.id, student.name];
    }));
  }

  function getVisibleRows() {
    return state.schedule ? History.getVisibleRows(state.schedule) : [];
  }

  function firstIncompleteWeek() {
    if (!state.schedule) return 0;
    const index = state.schedule.weeks.findIndex(function incomplete(week) {
      return !week.revealed.every(Boolean);
    });
    return index === -1 ? state.schedule.weeks.length - 1 : index;
  }

  function allComplete() {
    return Boolean(state.schedule && state.schedule.weeks.every(function complete(week) {
      return week.revealed.every(Boolean);
    }));
  }

  function hasAuditMetadata(schedule) {
    return Boolean(schedule && schedule.audit && typeof schedule.audit === "object");
  }

  function scheduleKindForSchedule(schedule) {
    if (!schedule) return "none";
    if (!hasAuditMetadata(schedule)) return "legacy-v3";
    if (schedule.audit.protocolId === "paper-question-picker/v6") return "audited-v6";
    if (schedule.audit.protocolId === "paper-question-picker/v5") return "audited-v5";
    if (schedule.audit.protocolId === "paper-question-picker/v4") return "audited-v4";
    return "audited-unsupported";
  }

  function scheduleHasPresenters(schedule) {
    return Boolean(schedule && schedule.weeks.length && schedule.weeks[0].assignments.length &&
      Object.hasOwn(schedule.weeks[0].assignments[0], "presenterId"));
  }

  function commitmentIsPublished(schedule) {
    return !hasAuditMetadata(schedule) || Boolean(schedule.audit.commitmentConfirmedAt);
  }

  function renderEmptyStage() {
    elements.stage.innerHTML = `
      <div class="card stage-card">
        <div class="stage-head">
          <div class="week-title"><span class="week-number muted-number">1</span><div><h2>抽签舞台</h2><p>确认左侧名单后，即可开始</p></div></div>
          <span class="badge neutral">等待生成</span>
        </div>
        <div class="paper-grid placeholder-grid">
          ${["本周论文 A", "本周论文 B", "本周论文 C"].map(function paperCard(paper, index) {
            return `<article class="paper-card placeholder-card">
              <div class="paper-kicker">论文 ${String(index + 1).padStart(2, "0")}</div>
              <h3>${paper}</h3>
              <div class="presenter-slot waiting"><span>报告人</span><b>等待抽取</b></div>
              <div class="role-label">提问人</div>
              <div class="slots">${[1, 2, 3].map(function slot(value) {
                return `<div class="slot waiting"><span>${value}</span>等待抽取</div>`;
              }).join("")}</div>
              <button class="button outline wide" type="button" disabled>抽取报告人与提问人</button>
            </article>`;
          }).join("")}
        </div>
        <div class="principle"><strong>分配原则：</strong>每人全程恰好报告 1 篇、提问 3 次；同篇论文的报告人与提问人不重复。</div>
      </div>`;
  }

  function paperOffsetForWeek(weekIndex) {
    if (!state.schedule) return 0;
    return state.schedule.weeks.slice(0, weekIndex).reduce(function countPapers(total, week) {
      return total + week.assignments.length;
    }, 0);
  }

  function weekLabelFor(week, weekIndex) {
    return week && typeof week.label === "string" && week.label.trim()
      ? week.label
      : "第 " + (weekIndex + 1) + " 周";
  }

  function renderStage() {
    if (!state.schedule) {
      renderEmptyStage();
      return;
    }
    const week = state.schedule.weeks[state.activeWeek];
    const names = getNameMap();
    const weekComplete = week.revealed.every(Boolean);
    const completeAll = allComplete();
    const hasPresenters = scheduleHasPresenters(state.schedule);
    const weekSize = week.assignments.length;
    const weekLabel = weekLabelFor(week, state.activeWeek);
    const paperOffset = paperOffsetForWeek(state.activeWeek);
    const unlockedThrough = firstIncompleteWeek();
    const revealDisabled = Boolean(state.revealing) || state.generating || state.importing ||
      !commitmentIsPublished(state.schedule);

    const completionBanner = completeAll
      ? `<div class="completion-banner"><span class="trophy" aria-hidden="true">★</span><div><h2>全部抽签完成</h2><p>${state.schedule.students.length} 篇论文已全部揭晓，${hasPresenters ? "每位学生恰好报告 1 篇、提问 3 次。" : "每位学生恰好提问 3 次；此旧版安排不含报告人。"}</p></div></div>`
      : "";

    elements.stage.innerHTML = `${completionBanner}
      <section class="card stage-card">
        <div class="stage-head">
          <div class="week-title"><span class="week-number">${state.activeWeek + 1}</span><div><h2>${escapeHtml(weekLabel)}</h2><p>${hasPresenters ? weekSize + " 篇论文 · " + weekSize + " 个报告名额 · " + (weekSize * 3) + " 个提问名额" : weekSize + " 篇论文 · " + (weekSize * 3) + " 个提问名额 · 旧版无报告人"}</p></div></div>
          <button class="button outline" type="button" data-action="reveal-week" ${weekComplete || revealDisabled ? "disabled" : ""}>
            <span aria-hidden="true">✦</span> ${weekComplete ? "本周已揭晓" : "全部揭晓本周"}
          </button>
        </div>
        <div class="week-tabs" aria-label="周次导航">
          ${state.schedule.weeks.map(function weekTab(item, index) {
            const complete = item.revealed.every(Boolean);
            const accessible = completeAll || index <= unlockedThrough;
            const className = index === state.activeWeek ? "active" : complete ? "complete" : "";
            const label = weekLabelFor(item, index);
            return `<button type="button" data-week="${index}" class="week-tab ${className}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}" ${!accessible || revealDisabled ? "disabled" : ""} ${index === state.activeWeek ? 'aria-current="step"' : ""}>${complete ? "✓ " : ""}${escapeHtml(label)}</button>`;
          }).join("")}
        </div>
      </section>

      <section class="paper-grid ${weekSize === 4 ? "four-paper-week" : ""}">
        ${week.assignments.map(function assignmentCard(assignment, paperIndex) {
          const revealed = week.revealed[paperIndex];
          const revealing = state.revealing === "all" || state.revealing === state.activeWeek + "-" + paperIndex;
          const presenterContent = !hasPresenters
            ? "旧版未分配"
            : revealed
              ? escapeHtml(names[assignment.presenterId])
              : revealing ? "正在抽取…" : "等待抽取";
          const slots = assignment.studentIds.map(function slot(studentId, slotIndex) {
            const content = revealed ? escapeHtml(names[studentId]) : revealing ? "正在抽取…" : "等待抽取";
            return `<div class="slot ${revealed ? "revealed" : revealing ? "shuffling" : "waiting"}"><span>${revealed ? "✓" : slotIndex + 1}</span><b>${content}</b></div>`;
          }).join("");
          return `<article class="paper-card ${revealed ? "is-revealed" : ""}">
            <div class="paper-top"><span class="paper-kicker">论文 ${String(paperOffset + paperIndex + 1).padStart(2, "0")}</span><span class="badge ${revealed ? "success" : "neutral"}">${revealed ? "✓ 已揭晓" : revealing ? "抽取中" : "待揭晓"}</span></div>
            <h3>${escapeHtml(assignment.paper)}</h3>
            <div class="presenter-slot ${!hasPresenters ? "unavailable" : revealed ? "revealed" : revealing ? "shuffling" : "waiting"}"><span>报告人</span><b>${presenterContent}</b></div>
            <div class="role-label">提问人</div>
            <div class="slots">${slots}</div>
            <button class="button ${revealed ? "soft" : "outline"} wide" type="button" data-paper="${paperIndex}" ${revealed || revealDisabled ? "disabled" : ""}>${revealed ? "✓ 抽取完成" : revealing ? "正在抽取…" : hasPresenters ? "⚄ 抽取 1 位报告人 + 3 位提问人" : "⚄ 抽取 3 位提问人"}</button>
          </article>`;
        }).join("")}
      </section>

      <section class="week-progress">
        <div class="progress-row">
          <div><strong>本周进度 <em>${week.revealed.filter(Boolean).length} / ${weekSize} 篇</em></strong><p>${weekComplete ? "本周 " + weekSize + " 篇结果已全部揭晓，可以继续。" : hasPresenters ? "每篇会同时揭晓报告人与提问人。" : "此旧版安排每篇只揭晓提问人。"}</p></div>
          <div class="progress-actions">
            <button class="button outline icon-button" type="button" data-action="previous" aria-label="上一周" ${state.activeWeek === 0 || revealDisabled ? "disabled" : ""}>‹</button>
            ${state.activeWeek < state.schedule.weeks.length - 1
              ? `<button class="button primary" type="button" data-action="next" ${!weekComplete || revealDisabled ? "disabled" : ""}>下一周 ›</button>`
              : `<span class="final-status ${completeAll ? "done" : ""}">${completeAll ? "✓ 全部完成" : "▣ 完成本周"}</span>`}
          </div>
        </div>
        <div class="progress-track"><span style="width:${week.revealed.filter(Boolean).length / weekSize * 100}%"></span></div>
      </section>`;
  }

  function renderHistory() {
    if (!state.schedule) {
      elements.historySection.hidden = true;
      return;
    }
    const rows = getVisibleRows();
    elements.historySection.hidden = false;
    elements.copyButton.disabled = rows.length === 0;
    elements.exportButton.disabled = rows.length === 0;
    if (!rows.length) {
      elements.historyContent.innerHTML = '<div class="empty-records">揭晓一篇论文后，结果会出现在这里。</div>';
      return;
    }
    elements.historyContent.innerHTML = `<div class="table-scroll"><table><thead><tr><th>周次</th><th>论文</th><th>报告学生</th><th>提问学生</th></tr></thead><tbody>${rows.map(function historyRow(row) {
      return `<tr><td>${escapeHtml(row.weekLabel || "第 " + row.week + " 周")}</td><td><strong>${escapeHtml(row.paper)}</strong></td><td><span class="presenter-tag ${row.presenter ? "" : "muted"}">${row.presenter ? escapeHtml(row.presenter) : "旧版未分配"}</span></td><td><div class="name-tags">${row.names.map(function nameTag(name) { return `<span>${escapeHtml(name)}</span>`; }).join("")}</div></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function formatArchiveTime(value, compact) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "时间未知";
    return new Intl.DateTimeFormat("zh-CN", compact ? {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    } : {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function archiveResultsHtml(rows) {
    if (!rows.length) {
      return '<div class="empty-archive-results">尚未揭晓论文，因此没有可显示的学生结果。</div>';
    }
    return `<div class="table-scroll archive-table"><table><thead><tr><th>周次</th><th>论文</th><th>报告学生</th><th>提问学生</th></tr></thead><tbody>${rows.map(function archiveRow(row) {
      return `<tr><td>${escapeHtml(row.weekLabel || "第 " + row.week + " 周")}</td><td><strong>${escapeHtml(row.paper)}</strong></td><td><span class="presenter-tag ${row.presenter ? "" : "muted"}">${row.presenter ? escapeHtml(row.presenter) : "旧版未分配"}</span></td><td><div class="name-tags">${row.names.map(function archiveName(name) {
        return `<span>${escapeHtml(name)}</span>`;
      }).join("")}</div></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function renderArchives() {
    const archives = state.archives;
    elements.archiveSection.hidden = false;
    elements.archiveCount.textContent = archives.length + " 次";
    const hasDraft = Boolean(elements.studentsInput.value.trim() || elements.papersInput.value.trim());
    elements.backupExportButton.disabled = state.importing ||
      (archives.length === 0 && !state.schedule && !hasDraft);
    elements.backupImportButton.disabled = state.importing;
    if (!archives.length) {
      elements.archiveList.innerHTML = '<div class="empty-records">还没有历史存档。生成抽签后会自动记录，也可以导入以前下载的完整备份。</div>';
      return;
    }

    elements.archiveList.innerHTML = archives.map(function archiveCard(session) {
      const rows = History.getVisibleRows(session.schedule);
      const archivedCourse = Course.parseCourseInput(session.paperText);
      const cancelledCount = archivedCourse.errors.length ? 0 : archivedCourse.excludedRows.length;
      const totalPapers = session.schedule.students.length;
      const revealedPapers = rows.length;
      const isCurrent = Boolean(state.schedule && state.sessionId === session.id);
      const complete = revealedPapers === totalPapers;
      const operations = session.operations.slice().reverse();
      const statusClass = complete ? "success" : isCurrent ? "current" : "neutral";
      const statusText = complete ? "✓ 已完成" : isCurrent ? "● 当前进度" : "可恢复";
      const protocolVersion = session.schedule.audit && session.schedule.audit.protocolId === "paper-question-picker/v6"
        ? "v6（可变周次）"
        : scheduleHasPresenters(session.schedule) ? "v5（含报告人）" : "v4（仅提问人）";
      const auditLabel = hasAuditMetadata(session.schedule)
        ? protocolVersion + " · " +
          "承诺 " + escapeHtml(session.schedule.audit.commitment.slice(0, 12)) + "…" +
          (session.schedule.audit.commitmentConfirmedAt ? " · 已自确认公开" : " · 尚未确认公开")
        : "旧版记录 · 不支持重放验证";
      return `<article class="archive-item ${isCurrent ? "is-current" : ""}">
        <div class="archive-overview">
          <div class="archive-mark" aria-hidden="true">${complete ? "✓" : "↶"}</div>
          <div class="archive-summary">
            <strong>${escapeHtml(formatArchiveTime(session.createdAt, false))} 的抽签</strong>
            <p>${totalPapers} 名学生 · ${totalPapers} 篇有效论文 · ${session.schedule.weeks.length} 周 · 已揭晓 ${revealedPapers}/${totalPapers} 篇${cancelledCount ? " · 另存 " + cancelledCount + " 篇取消标记" : ""}</p>
            <span>最后操作：${escapeHtml(formatArchiveTime(session.updatedAt, true))}</span>
            <span>${auditLabel}</span>
          </div>
          <span class="archive-status ${statusClass}">${statusText}</span>
        </div>
        <div class="archive-actions">
          <button class="button outline small" type="button" data-archive-action="restore" data-session-id="${session.id}" ${isCurrent || state.importing ? "disabled" : ""}>${isCurrent ? "正在使用" : "恢复此进度"}</button>
          <button class="button outline small" type="button" data-archive-action="export" data-session-id="${session.id}" ${rows.length ? "" : "disabled"}>导出结果</button>
        </div>
        <details class="archive-details">
          <summary>查看操作记录与已揭晓结果</summary>
          <div class="archive-detail-body">
            <section class="operation-panel">
              <h3>操作记录</h3>
              ${operations.length ? `<ol class="operation-list">${operations.map(function operationItem(operation) {
                return `<li><time>${escapeHtml(formatArchiveTime(operation.at, true))}</time><span>${escapeHtml(operation.description)}</span></li>`;
              }).join("")}</ol>` : '<p class="empty-operation">暂无操作记录。</p>'}
            </section>
            <section class="archive-results-panel">
              <h3>已揭晓结果</h3>
              ${archiveResultsHtml(rows)}
            </section>
          </div>
        </details>
      </article>`;
    }).join("");
  }

  function renderStats() {
    if (!state.schedule) {
      elements.statsSection.hidden = true;
      return;
    }
    const counts = Core.countRevealedSelections(state.schedule);
    const presentationCounts = Core.countRevealedPresentations(state.schedule);
    const hasPresenters = scheduleHasPresenters(state.schedule);
    const revealedPapers = state.schedule.weeks.reduce(function countPapers(total, week) {
      return total + week.revealed.filter(Boolean).length;
    }, 0);
    const totalPapers = state.schedule.students.length;
    const percent = Math.round(revealedPapers / totalPapers * 100);
    elements.statsSection.hidden = false;
    elements.courseProgressCount.textContent = revealedPapers + " / " + totalPapers + " 篇";
    elements.courseProgressPercent.textContent = "全课程 " + percent + "%";
    elements.courseProgressBar.style.width = percent + "%";
    elements.statsGrid.innerHTML = state.schedule.students.map(function studentStat(student) {
      const count = counts[student.id] || 0;
      const dots = [0, 1, 2].map(function countDot(index) {
        return `<i class="${index < count ? "filled" : ""}"></i>`;
      }).join("");
      const presentationCount = presentationCounts[student.id] || 0;
      return `<div class="student-stat"><strong>${escapeHtml(student.name)}</strong><span class="count-dots" aria-hidden="true">${dots}</span><span class="role-counts"><b>提问 ${count}/3</b>${hasPresenters ? `<b class="presentation-count">报告 ${presentationCount}/1</b>` : '<small>旧版无报告安排</small>'}</span></div>`;
    }).join("");
  }

  function renderTransparency() {
    if (!elements.commitmentSection) return;
    if (!state.schedule) {
      elements.commitmentSection.hidden = true;
      if (elements.auditPanel) elements.auditPanel.hidden = true;
      if (elements.auditSeed) elements.auditSeed.textContent = "";
      return;
    }

    elements.commitmentSection.hidden = false;
    const audit = state.schedule.audit;
    const isAudited = hasAuditMetadata(state.schedule);
    const complete = allComplete();
    const confirmed = isAudited && Boolean(audit.commitmentConfirmedAt);

    if (!isAudited) {
      elements.commitmentBadge.className = "badge neutral";
      elements.commitmentBadge.textContent = "旧版记录";
      elements.commitmentCode.textContent = "此安排生成于可验证抽签功能上线前，没有承诺码。";
      elements.commitmentInputSummary.textContent = "旧版安排仍可继续使用，但不能用种子重放验证。";
      elements.copyCommitmentButton.hidden = true;
      elements.exportCommitmentButton.hidden = true;
      elements.confirmPublishedButton.hidden = true;
      elements.auditPanel.hidden = true;
      elements.auditSeed.textContent = "";
      return;
    }

    elements.commitmentCode.textContent = audit.commitment;
    const protocolLabel = audit.protocolId === "paper-question-picker/v6"
      ? "v6 分周提问+报告协议"
      : scheduleHasPresenters(state.schedule) ? "v5 提问+报告协议" : "v4 仅提问协议";
    elements.commitmentInputSummary.textContent = state.schedule.students.length + " 名学生 · " +
      state.schedule.students.length + " 篇有效论文 · " + state.schedule.weeks.length + " 周 · " +
      protocolLabel +
      " · 输入摘要 " + audit.inputDigest;
    elements.copyCommitmentButton.hidden = false;
    elements.exportCommitmentButton.hidden = false;
    elements.confirmPublishedButton.hidden = confirmed;
    elements.confirmPublishedButton.disabled = confirmed;

    if (complete) {
      elements.commitmentBadge.className = "badge success";
      elements.commitmentBadge.textContent = "✓ 可复核";
    } else if (confirmed) {
      elements.commitmentBadge.className = "badge success";
      elements.commitmentBadge.textContent = "✓ 已自确认公开";
    } else {
      elements.commitmentBadge.className = "badge pending";
      elements.commitmentBadge.textContent = "待公开";
    }

    elements.auditPanel.hidden = !complete;
    elements.auditSeed.textContent = complete ? audit.seedHex : "";
    elements.exportAuditButton.disabled = !complete;
  }

  function renderAll(options) {
    const skipSave = Boolean(options && options.skipSave);
    setLocked(Boolean(state.schedule));
    refreshInputs(skipSave);
    renderTransparency();
    renderStage();
    renderArchives();
    renderHistory();
    renderStats();
  }

  function generateSchedule() {
    const result = validation();
    if (result.errors.length || state.revealing || state.generating || state.importing) return;
    if (state.storageWriteBlocked || state.historyWriteBlocked) {
      if (!window.confirm(
        "检测到无法读取的旧进度或历史。继续生成会先把原始数据另存为隔离副本，再创建新的 v6 进度。\n\n确定继续吗？",
      )) return;
      if (!preserveUnreadableCurrent() || !preserveUnreadableHistory()) return;
    }
    state.generating = true;
    elements.generateButton.disabled = true;
    elements.studentsInput.disabled = true;
    elements.papersInput.disabled = true;
    elements.courseButton.disabled = true;
    elements.exampleButton.disabled = true;
    elements.clearButton.disabled = true;
    elements.generateButton.innerHTML = '<span class="pulse" aria-hidden="true">✦</span> 正在分配角色…';
    setStatus("正在平衡提问次数并匹配报告人…");
    state.timer = window.setTimeout(function finishGenerate() {
      try {
        elements.studentsInput.value = result.students.join("\n");
        state.schedule = Audit.createAuditedSchedule(result.students, result.courseWeeks);
        state.activeWeek = 0;
        state.sessionId = null;
        const savedToHistory = recordHistory("generate", "生成完整提问人与报告人安排");
        setStatus(savedToHistory
          ? "安排已生成并存入历史。请先把承诺码发到班级群，再确认开始抽签。"
          : "安排已生成，但历史存档暂时无法写入。请先导出并公开承诺凭证，再确认开始抽签。");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "生成失败，请检查输入。");
      }
      elements.generateButton.innerHTML = '<span aria-hidden="true">⚄</span> 生成完整抽签';
      elements.courseButton.disabled = false;
      elements.exampleButton.disabled = false;
      elements.clearButton.disabled = false;
      state.generating = false;
      state.timer = null;
      renderAll();
      saveState();
    }, 420);
  }

  function updateRevealed(paperIndexes) {
    const week = state.schedule.weeks[state.activeWeek];
    week.revealed = week.revealed.map(function reveal(value, index) {
      return value || paperIndexes.includes(index);
    });
  }

  function revealPaper(paperIndex) {
    const week = state.schedule && state.schedule.weeks[state.activeWeek];
    if (!week || week.revealed[paperIndex] || state.revealing || state.generating || state.importing) return;
    if (!commitmentIsPublished(state.schedule)) {
      setStatus("请先公开承诺凭证并确认，之后才能揭晓抽签结果。");
      return;
    }
    const assignment = week.assignments[paperIndex];
    const names = getNameMap();
    const hasPresenter = Object.hasOwn(assignment, "presenterId");
    state.revealing = state.activeWeek + "-" + paperIndex;
    setStatus("正在为《" + assignment.paper + "》抽取" +
      (hasPresenter ? "报告人与提问同学" : "提问同学") + "…");
    renderStage();
    state.timer = window.setTimeout(function finishReveal() {
      updateRevealed([paperIndex]);
      state.revealing = null;
      state.timer = null;
      const selectedNames = assignment.studentIds.map(function name(id) { return names[id]; });
      const resultText = hasPresenter
        ? "报告人 " + names[assignment.presenterId] + "；提问人 " + selectedNames.join("、")
        : "提问人 " + selectedNames.join("、");
      const savedToHistory = recordHistory(
        "reveal-paper",
        "揭晓《" + assignment.paper + "》：" + resultText,
      );
      setStatus(savedToHistory
        ? "抽取完成并已记录：" + resultText + "。"
        : "抽取完成：" + resultText + "。当前进度已保留，但历史记录写入失败。");
      renderAll();
      saveState();
    }, 900);
  }

  function revealWeek() {
    const week = state.schedule && state.schedule.weeks[state.activeWeek];
    if (!week || week.revealed.every(Boolean) || state.revealing || state.generating || state.importing) return;
    if (!commitmentIsPublished(state.schedule)) {
      setStatus("请先公开承诺凭证并确认，之后才能揭晓抽签结果。");
      return;
    }
    const pending = week.revealed.map(function pendingIndex(value, index) { return value ? -1 : index; }).filter(function valid(index) { return index >= 0; });
    const hasPresenters = scheduleHasPresenters(state.schedule);
    const weekLabel = weekLabelFor(week, state.activeWeek);
    state.revealing = "all";
    setStatus("正在揭晓“" + weekLabel + "”剩余结果…");
    renderStage();
    state.timer = window.setTimeout(function finishWeek() {
      updateRevealed(pending);
      state.revealing = null;
      state.timer = null;
      const savedToHistory = recordHistory(
        "reveal-week",
        "批量揭晓“" + weekLabel + "”剩余 " + pending.length + " 篇论文",
      );
      setStatus(savedToHistory
        ? "“" + weekLabel + "”的" + (hasPresenters ? "报告人与提问人" : "提问人") + "已全部揭晓并记录。"
        : "“" + weekLabel + "”已全部揭晓；当前进度已保留，但历史记录写入失败。");
      renderAll();
      saveState();
    }, 900);
  }

  function resetResults() {
    if (!state.schedule || state.revealing || state.generating || state.importing) return;
    if (!window.confirm("确定重新开始吗？当前完整进度会先保存到历史存档，学生和论文名单会保留。")) return;
    if (!recordHistory("reset", "重新开始前自动保存当前进度")) {
      setStatus("为避免丢失数据，本次重置已取消。请先释放浏览器存储空间后再试。");
      return;
    }
    if (state.timer) window.clearTimeout(state.timer);
    state.schedule = null;
    state.activeWeek = 0;
    state.revealing = null;
    state.sessionId = null;
    setStatus("已重新开始；刚才的完整进度仍在“历史存档”中，可随时恢复。");
    renderAll();
    saveState();
  }

  function loadExample() {
    if (state.importing || state.generating) return;
    elements.studentsInput.value = EXAMPLE_STUDENTS;
    elements.papersInput.value = EXAMPLE_COURSE;
    setStatus("已载入 12 人、4 周共 12 篇论文的匿名示例。");
    renderAll();
  }

  function clearInputs() {
    if (state.importing || state.generating) return;
    if ((elements.studentsInput.value.trim() || elements.papersInput.value.trim()) && !window.confirm("确定清空学生和论文名单吗？")) return;
    elements.studentsInput.value = "";
    elements.papersInput.value = "";
    setStatus("名单已清空。");
    renderAll();
  }

  function quoteCsv(value) {
    const text = String(value);
    const safeText = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
    return '"' + safeText.replaceAll('"', '""') + '"';
  }

  async function copyResults() {
    const rows = getVisibleRows();
    if (!rows.length) return;
    const text = rows.map(function textRow(row) {
      return (row.weekLabel || "第 " + row.week + " 周") + "｜" + row.paper + "｜报告人：" +
        (row.presenter || "旧版未分配") + "｜提问人：" + row.names.join("、");
    }).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setStatus("已复制 " + rows.length + " 篇论文的抽签结果。");
    } catch (_error) {
      setStatus("复制失败，请使用导出功能保存结果。");
    }
  }

  function exportRowsCsv(rows, filename) {
    if (!rows.length) return;
    const data = [
      ["周序号", "周次/日期", "论文", "报告学生", "提问学生 1", "提问学生 2", "提问学生 3"],
    ].concat(rows.map(function csvRow(row) {
      return [row.week, row.weekLabel || "第 " + row.week + " 周", row.paper, row.presenter || ""].concat(row.names);
    }));
    const csv = data.map(function formatRow(row) { return row.map(quoteCsv).join(","); }).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(function cleanUrl() { URL.revokeObjectURL(url); }, 1000);
    setStatus("已导出 " + rows.length + " 篇论文的结果。");
  }

  function exportCsv() {
    exportRowsCsv(getVisibleRows(), "论文提问抽签结果.csv");
  }

  function exportArchiveCsv(sessionId) {
    const session = state.archives.find(function findSession(item) { return item.id === sessionId; });
    if (!session) return;
    const dateLabel = session.createdAt.slice(0, 10);
    exportRowsCsv(History.getVisibleRows(session.schedule), "论文提问抽签历史-" + dateLabel + ".csv");
  }

  function auditDateLabel(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "unknown";
    function twoDigits(number) { return String(number).padStart(2, "0"); }
    return date.getFullYear() + "-" + twoDigits(date.getMonth() + 1) + "-" + twoDigits(date.getDate()) + "-" +
      twoDigits(date.getHours()) + twoDigits(date.getMinutes());
  }

  function downloadJsonDocument(documentValue, filename, maximumBytes) {
    const source = JSON.stringify(documentValue, null, 2);
    const blob = new Blob([source], { type: "application/json;charset=utf-8" });
    if (maximumBytes && blob.size > maximumBytes) {
      throw new Error("生成的 JSON 文件超过 64 MiB 安全上限，未下载文件。请缩短名单文字或减少历史存档后重试。");
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(function cleanJsonUrl() { URL.revokeObjectURL(url); }, 1000);
  }

  function publicReceiptForCurrentSchedule() {
    if (!state.schedule || !hasAuditMetadata(state.schedule)) {
      throw new Error("这是一条旧版抽签记录，没有可导出的公开承诺凭证。");
    }
    return Audit.createPublicReceipt(state.schedule);
  }

  function publicReceiptShareText(receipt) {
    return [
      "论文提问抽签 · 事前公开承诺",
      "承诺码：" + receipt.commitment,
      "输入摘要：" + receipt.inputDigest,
      "协议：" + receipt.protocolId,
      "随机算法：" + receipt.rngId,
      "排程算法：" + receipt.scheduleId,
      "规模：" + receipt.studentCount + " 名学生 / " + receipt.paperCount + " 篇有效论文 / " +
        (receipt.weekCount || receipt.paperCount / 3) + " 周" +
        (Array.isArray(receipt.weekPaperCounts) ? "（" + receipt.weekPaperCounts.join("、") + " 篇）" : ""),
      receipt.version >= 5
        ? "规则：每篇 1 位报告人 + 3 位提问人；每人恰好报告 1 篇、提问 3 次；同篇两种角色不重复。"
        : "规则：v4 旧协议仅分配提问人，不包含报告人。",
      "生成时间（本机自报）：" + receipt.issuedAt,
      "请保存本消息与 JSON 凭证。课程结束后可在本地验证器中与完整审计报告交叉核对。",
      "验证器：https://zjwulbx.github.io/paper-question-picker/verify.html",
    ].join("\n");
  }

  async function copyCommitment() {
    try {
      const receipt = publicReceiptForCurrentSchedule();
      await navigator.clipboard.writeText(publicReceiptShareText(receipt));
      setStatus("公开承诺信息已复制，可用于快速核对；请再导出公开承诺 JSON 并发到班级群，以便课后本地验证。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "复制承诺码失败，请改用导出公开凭证。");
    }
  }

  function exportPublicReceipt() {
    try {
      const receipt = publicReceiptForCurrentSchedule();
      downloadJsonDocument(
        receipt,
        "论文提问抽签-公开承诺-" + auditDateLabel(receipt.issuedAt) + ".json",
      );
      setStatus("公开承诺凭证已导出。它不含姓名、随机种子或未揭晓结果，可以发到班级群留证。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "公开承诺凭证导出失败。");
    }
  }

  function confirmPublishedCommitment() {
    if (!state.schedule || !hasAuditMetadata(state.schedule) || state.schedule.audit.commitmentConfirmedAt ||
        state.revealing || state.generating || state.importing) return;
    if (!window.confirm(
      "请确认：公开承诺 JSON 已经发到班级群并保存，群里能看到消息时间（复制文字可同时用于快速核对）。\n\n" +
      "确认后才能揭晓结果；群消息才是事前发布的时间证据。",
    )) return;
    try {
      Audit.confirmCommitment(state.schedule, new Date().toISOString());
      const recorded = recordHistory(
        "publish-commitment",
        "确认已公开承诺码 " + state.schedule.audit.commitment.slice(0, 12) + "…",
      );
      setStatus(recorded
        ? "已记录你对公开凭证的确认，现在可以开始抽签；是否确实提前公开仍以群消息为准。"
        : "已记录本页确认，现在可以开始抽签；请保留群里的公开凭证，操作历史暂时无法写入。");
      renderAll();
      saveState();
      elements.stage.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "承诺确认失败，尚未开放抽签。");
    }
  }

  function exportFinalAudit() {
    if (!state.schedule || !hasAuditMetadata(state.schedule) || !allComplete()) return;
    if (!window.confirm(
      "完整审计报告会公开随机种子、学生名单、论文名称和全部分配结果。\n\n" +
      "请仅在课程全部抽签完成后，在合适的班级范围内分享。确定导出吗？",
    )) return;
    try {
      const report = Audit.createFinalReport(state.schedule);
      downloadJsonDocument(
        report,
        "论文提问抽签-完整审计报告-" + auditDateLabel(report.completedAt) + ".json",
        MAX_AUDIT_FILE_BYTES,
      );
      setStatus("完整审计报告已导出。请与事前保存在群里的公开承诺凭证一起交给验证器。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "完整审计报告导出失败。");
    }
  }

  function formatBackupFilename(date) {
    function twoDigits(value) { return String(value).padStart(2, "0"); }
    return "论文提问抽签-私密完整备份-" + date.getFullYear() + "-" +
      twoDigits(date.getMonth() + 1) + "-" + twoDigits(date.getDate()) + "-" +
      twoDigits(date.getHours()) + twoDigits(date.getMinutes()) + ".json";
  }

  function downloadCompleteBackup() {
    try {
      const archives = History.mergeSessions(
        state.archives,
        readArchivesFromStorage(),
        verifyStoredSchedule,
        new Date().toISOString(),
        Infinity,
      );
      const containsUnfinishedSecret = archives.some(function unfinished(session) {
        return session.schedule.weeks.some(function pendingWeek(week) {
          return week.revealed.some(function pending(value) { return !value; });
        });
      }) || Boolean(state.schedule && !allComplete());
      const backupWarning = containsUnfinishedSecret
        ? "私密完整备份含有随机种子和尚未揭晓的完整安排。任何拿到文件的人都能提前看到未来结果。\n\n" +
          "它始终是私密恢复文件，请只保存到你信任的位置，不要发群或公开分享。确定下载吗？"
        : "私密完整备份含有学生姓名、随机种子、完整安排和操作历史。它用于恢复数据，不是公开验证材料。\n\n" +
          "请只保存到你信任的位置，不要发群或公开分享。确定下载吗？";
      if (!window.confirm(backupWarning)) {
        setStatus("已取消私密备份下载，本机数据没有变化。");
        return;
      }
      const snapshot = currentSnapshot();
      const matchingSession = snapshot.sessionId && archives.find(function findCurrent(session) {
        return session.id === snapshot.sessionId &&
          (!snapshot.schedule || History.sameSchedulePlan(session.schedule, snapshot.schedule));
      });
      if (!matchingSession) snapshot.sessionId = null;

      const now = new Date();
      const backup = History.createBackup(snapshot, archives, verifyStoredSchedule, now.toISOString());
      const source = JSON.stringify(backup, null, 2);
      const blob = new Blob([source], { type: "application/json;charset=utf-8" });
      if (blob.size > MAX_BACKUP_FILE_BYTES) {
        throw new Error("私密完整备份超过 64 MiB，未下载文件。请先减少历史存档或缩短名单文字。");
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = formatBackupFilename(now);
      anchor.click();
      window.setTimeout(function cleanBackupUrl() { URL.revokeObjectURL(url); }, 1000);
      setStatus("私密完整备份已下载，包含当前进度、种子和 " + archives.length + " 次历史存档；请始终只保存在可信位置。");
    } catch (error) {
      setStatus(error instanceof Error
        ? error.message
        : "完整备份生成失败，请刷新页面后重试；当前本机数据不会被更改。");
    }
  }

  function readStoredHistoryForImport() {
    if (state.historyWriteBlocked) return state.archives.slice();
    try {
      return readArchivesFromStorage();
    } catch (error) {
      captureHistoryFailure(error);
      return state.archives.slice();
    }
  }

  function captureImportStorageRevision() {
    return {
      current: localStorage.getItem(STORAGE_KEY),
      previousCurrent: localStorage.getItem(PREVIOUS_STORAGE_KEY),
      v4Current: localStorage.getItem(V4_STORAGE_KEY),
      legacyCurrent: localStorage.getItem(LEGACY_STORAGE_KEY),
      history: localStorage.getItem(HISTORY_STORAGE_KEY),
      previousHistory: localStorage.getItem(PREVIOUS_HISTORY_STORAGE_KEY),
      v4History: localStorage.getItem(V4_HISTORY_STORAGE_KEY),
      legacyHistory: localStorage.getItem(LEGACY_HISTORY_STORAGE_KEY),
    };
  }

  function importStorageRevisionMatches(revision) {
    return localStorage.getItem(STORAGE_KEY) === revision.current &&
      localStorage.getItem(PREVIOUS_STORAGE_KEY) === revision.previousCurrent &&
      localStorage.getItem(V4_STORAGE_KEY) === revision.v4Current &&
      localStorage.getItem(LEGACY_STORAGE_KEY) === revision.legacyCurrent &&
      localStorage.getItem(HISTORY_STORAGE_KEY) === revision.history &&
      localStorage.getItem(PREVIOUS_HISTORY_STORAGE_KEY) === revision.previousHistory &&
      localStorage.getItem(V4_HISTORY_STORAGE_KEY) === revision.v4History &&
      localStorage.getItem(LEGACY_HISTORY_STORAGE_KEY) === revision.legacyHistory;
  }

  function restoreStoredValue(key, rawValue) {
    if (rawValue === null) localStorage.removeItem(key);
    else localStorage.setItem(key, rawValue);
  }

  function commitImportedStorage(nextArchives, nextCurrent) {
    let previousHistory;
    let previousCurrent;
    let wroteHistory = false;
    let wroteCurrent = false;
    try {
      previousHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
      previousCurrent = localStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return { ok: false, rollbackOk: true };
    }

    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({
        schemaVersion: History.SCHEMA_VERSION,
        sessions: nextArchives,
      }));
      wroteHistory = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({
        appVersion: 6,
        scheduleKind: scheduleKindForSchedule(nextCurrent.schedule),
      }, nextCurrent)));
      wroteCurrent = true;
      return { ok: true, rollbackOk: true };
    } catch (_error) {
      let rollbackOk = true;
      try {
        if (wroteHistory) restoreStoredValue(HISTORY_STORAGE_KEY, previousHistory);
        if (wroteCurrent) restoreStoredValue(STORAGE_KEY, previousCurrent);
      } catch (_rollbackError) {
        rollbackOk = false;
      }
      return { ok: false, rollbackOk: rollbackOk };
    }
  }

  function currentStatesEqual(left, right) {
    if (!left || !right || Boolean(left.schedule) !== Boolean(right.schedule)) return false;
    if (left.studentText !== right.studentText || left.paperText !== right.paperText) return false;
    if (!left.schedule) return true;
    return left.activeWeek === right.activeWeek &&
      JSON.stringify(left.schedule) === JSON.stringify(right.schedule);
  }

  function importImpactDescription(importedCurrent, localCurrent) {
    if (importedCurrent.schedule) {
      return localCurrent.schedule
        ? "备份中的当前抽签会替换本页；本页当前进度会先另存为一条历史。"
        : "备份中的当前抽签会恢复到本页。";
    }
    if (localCurrent.schedule) {
      return "备份没有进行中的抽签，本页当前进度会保留，只合并历史存档。";
    }
    return "备份中的学生和论文名单会恢复到本页。";
  }

  async function importCompleteBackup(event) {
    const file = event && event.target && event.target.files
      ? event.target.files[0]
      : elements.backupFileInput.files && elements.backupFileInput.files[0];
    if (!file) return;
    if (state.revealing || state.generating || state.importing) {
      setStatus("正在生成、抽取或导入，请等待本次操作完成后再导入备份。");
      elements.backupFileInput.value = "";
      return;
    }
    const importToken = {};
    state.importing = true;
    state.importToken = importToken;
    renderAll({ skipSave: true });

    try {
      if (typeof file.size === "number" && file.size > MAX_BACKUP_FILE_BYTES) {
        throw new Error("备份文件超过 64 MiB，未导入任何内容。");
      }

      const source = (await file.text()).replace(/^\uFEFF/, "");
      if (state.importToken !== importToken) throw new Error("导入任务已失效，未更改本机数据。");
      if (new Blob([source]).size > MAX_BACKUP_FILE_BYTES) {
        throw new Error("备份文件解码后超过 64 MiB，未导入任何内容。");
      }
      let candidate;
      try {
        candidate = JSON.parse(source);
      } catch (_error) {
        throw new Error("备份文件不是有效的 JSON，未导入任何内容。");
      }
      const imported = History.parseBackup(candidate, verifyStoredSchedule);
      const storageRevision = captureImportStorageRevision();
      const stored = readStoredHistoryForImport();
      let localArchives = History.mergeSessions(
        state.archives,
        stored,
        verifyStoredSchedule,
        new Date().toISOString(),
        Infinity,
      );

      imported.sessions.forEach(function detectIdConflict(incoming) {
        const existing = localArchives.find(function sameId(session) { return session.id === incoming.id; });
        if (existing && !History.sameSchedulePlan(existing.schedule, incoming.schedule)) {
          throw new Error("备份与本机存在编号相同但内容不同的历史存档，未导入任何内容。");
        }
      });

      const localCurrent = currentSnapshot();
      if (localCurrent.schedule && localCurrent.sessionId) {
        const newestCurrentArchive = localArchives.find(function sameCurrentSession(session) {
          return session.id === localCurrent.sessionId &&
            History.sameSchedulePlan(session.schedule, localCurrent.schedule);
        });
        if (newestCurrentArchive) {
          const synchronized = History.upsertSession(localArchives, localCurrent, null,
            verifyStoredSchedule, {
              sessionId: localCurrent.sessionId,
              now: new Date().toISOString(),
              limit: Infinity,
            });
          localArchives = synchronized.sessions;
          const synchronizedCurrent = localArchives.find(function currentAfterSync(session) {
            return session.id === synchronized.sessionId;
          });
          if (synchronizedCurrent) localCurrent.schedule = History.clone(synchronizedCurrent.schedule);
        }
      }
      if (!importStorageRevisionMatches(storageRevision)) {
        setStatus("准备导入时另一窗口更新了抽签数据。为避免覆盖新进度，本次导入已取消；请刷新页面后重试。");
        return;
      }
      const unreadableWarning = state.storageWriteBlocked || state.historyWriteBlocked
        ? "\n\n检测到无法读取的旧进度或历史；确认后会先保存原始隔离副本，再用可读取的数据完成恢复。"
        : "";
      const confirmation = "准备导入 " + formatArchiveTime(imported.exportedAt, false) +
        " 导出的完整备份，共 " + imported.sessions.length + " 次历史存档。\n\n" +
        importImpactDescription(imported.current, localCurrent) +
        "\n历史会与本机记录合并，整个过程不会上传网络。" + unreadableWarning + "\n\n确定继续吗？";
      if (!window.confirm(confirmation)) {
        setStatus("已取消导入，本机数据没有变化。");
        return;
      }
      if (!importStorageRevisionMatches(storageRevision)) {
        setStatus("导入确认期间另一窗口更新了抽签数据。为避免覆盖新进度，本次导入已取消；请刷新页面后重试。");
        return;
      }

      const latestKnownTimestamp = Math.max(
        Date.now(),
        Date.parse(imported.exportedAt),
        imported.current.schedule ? Date.parse(imported.current.schedule.createdAt) : 0,
        localCurrent.schedule ? Date.parse(localCurrent.schedule.createdAt) : 0,
        localArchives.reduce(function latestHistoryTime(latest, session) {
          return Math.max(latest, Date.parse(session.updatedAt));
        }, 0),
      );
      const now = new Date(latestKnownTimestamp).toISOString();
      let nextArchives = History.mergeSessions(
        localArchives,
        imported.sessions,
        verifyStoredSchedule,
        now,
        Infinity,
      );
      let nextCurrent = {
        studentText: localCurrent.studentText,
        paperText: localCurrent.paperText,
        schedule: localCurrent.schedule ? History.clone(localCurrent.schedule) : null,
        activeWeek: localCurrent.activeWeek,
        sessionId: localCurrent.sessionId,
      };

      if (imported.current.schedule) {
        let restoreSessionId = imported.current.sessionId;
        const sameLogicalDraw = Boolean(localCurrent.schedule &&
          History.sameSchedulePlan(localCurrent.schedule, imported.current.schedule));
        if (sameLogicalDraw) {
          const mergedLocal = History.upsertSession(nextArchives, localCurrent, null,
            verifyStoredSchedule, {
              sessionId: imported.current.sessionId || localCurrent.sessionId,
              now: now,
              limit: Infinity,
            });
          nextArchives = mergedLocal.sessions;
          restoreSessionId = mergedLocal.sessionId;
        } else if (localCurrent.schedule && !currentStatesEqual(localCurrent, imported.current)) {
          const preserved = History.upsertSession(nextArchives, localCurrent, {
            type: "archive",
            description: "导入完整备份前自动保存当前进度",
          }, verifyStoredSchedule, {
            sessionId: null,
            now: now,
            limit: Infinity,
          });
          nextArchives = preserved.sessions;
        }

        const restored = History.upsertSession(nextArchives, imported.current, {
          type: "import-backup",
          description: "从完整备份恢复当前进度",
        }, verifyStoredSchedule, {
          sessionId: restoreSessionId,
          now: now,
          limit: Infinity,
        });
        nextArchives = restored.sessions;
        const restoredSession = restored.sessions.find(function restoredCurrent(session) {
          return session.id === restored.sessionId;
        });
        if (!restoredSession) throw new Error("恢复后的当前进度没有对应历史存档。");
        nextCurrent = {
          studentText: restoredSession.studentText,
          paperText: restoredSession.paperText,
          schedule: History.clone(restoredSession.schedule),
          activeWeek: restoredSession.activeWeek,
          sessionId: restored.sessionId,
        };
      } else if (!localCurrent.schedule) {
        nextCurrent = {
          studentText: imported.current.studentText,
          paperText: imported.current.paperText,
          schedule: null,
          activeWeek: 0,
          sessionId: null,
        };
      }

      if (nextArchives.length > History.MAX_SESSIONS) {
        const dropCount = nextArchives.length - History.MAX_SESSIONS;
        if (!window.confirm(
          "合并后共有 " + nextArchives.length + " 次历史，浏览器最多保留 20 次。\n\n" +
          "继续将保留最近 20 次，并移除较早的 " + dropCount + " 次；取消则不作任何更改。",
        )) {
          setStatus("已取消导入，本机数据没有变化。");
          return;
        }
        nextArchives = nextArchives.slice(0, History.MAX_SESSIONS);
      }

      if (nextCurrent.sessionId && !nextArchives.some(function currentStillSaved(session) {
        return session.id === nextCurrent.sessionId;
      })) {
        nextCurrent.sessionId = null;
      }

      if (!importStorageRevisionMatches(storageRevision)) {
        setStatus("导入期间另一窗口更新了抽签数据。为避免覆盖新进度，本次导入已取消；请刷新页面后重试。");
        return;
      }

      if (!preserveUnreadableCurrent() || !preserveUnreadableHistory()) return;

      const committed = commitImportedStorage(nextArchives, nextCurrent);
      if (!committed.ok) {
        throw new Error(committed.rollbackOk
          ? "备份导入失败，已恢复导入前的数据。"
          : "浏览器写入失败，且无法确认是否完整回滚；请暂时不要关闭页面，并立即导出当前可见数据。"
        );
      }

      elements.studentsInput.value = nextCurrent.studentText;
      elements.papersInput.value = nextCurrent.paperText;
      state.schedule = nextCurrent.schedule ? History.clone(nextCurrent.schedule) : null;
      state.activeWeek = nextCurrent.activeWeek;
      state.sessionId = nextCurrent.sessionId;
      state.archives = nextArchives;
      state.blockedCurrentRaw = null;
      renderAll({ skipSave: true });
      const successDescription = imported.current.schedule
        ? "当前进度已恢复"
        : localCurrent.schedule
          ? "历史已合并，本页当前进度保持不变"
          : "学生和论文名单已恢复";
      setStatus("完整备份导入成功：" + successDescription + "，共保留 " + nextArchives.length + " 次历史存档。");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "备份导入失败，未更改本机数据。");
    } finally {
      const finalStatus = elements.visibleStatusText.textContent;
      elements.backupFileInput.value = "";
      if (state.importToken === importToken) {
        state.importing = false;
        state.importToken = null;
        renderAll({ skipSave: true });
        if (finalStatus) setStatus(finalStatus);
      }
    }
  }

  function restoreArchive(sessionId) {
    const selected = state.archives.find(function findSession(item) { return item.id === sessionId; });
    if (!selected || !verifyStoredSchedule(selected.schedule) || state.revealing || state.generating || state.importing) return;
    if (state.schedule && state.sessionId === selected.id) return;
    if (!window.confirm("确定恢复 " + formatArchiveTime(selected.createdAt, false) + " 的抽签进度吗？当前界面内容会被替换。")) return;
    if (!preserveUnreadableCurrent() || !preserveUnreadableHistory()) return;

    if (state.schedule && !recordHistory("archive", "恢复其他存档前自动保存当前进度")) {
      setStatus("为避免覆盖当前数据，恢复操作已取消。请先释放浏览器存储空间后再试。");
      return;
    }

    if (state.timer) window.clearTimeout(state.timer);
    elements.studentsInput.value = selected.studentText;
    elements.papersInput.value = selected.paperText;
    state.schedule = History.clone(selected.schedule);
    state.activeWeek = selected.activeWeek;
    state.revealing = null;
    state.timer = null;
    state.sessionId = selected.id;
    const restoredInHistory = recordHistory(
      "restore",
      "从 " + formatArchiveTime(selected.createdAt, false) + " 的存档恢复进度",
    );
    setStatus(restoredInHistory
      ? "历史进度已恢复，可以从原来的位置继续抽签。"
      : "历史进度已恢复；当前进度会继续单独保存在本机。");
    renderAll();
    saveState();
    elements.stage.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  elements.studentsInput.addEventListener("input", refreshInputs);
  elements.papersInput.addEventListener("input", refreshInputs);
  elements.generateButton.addEventListener("click", generateSchedule);
  elements.editButton.addEventListener("click", resetResults);
  elements.resetTop.addEventListener("click", resetResults);
  elements.exampleButton.addEventListener("click", loadExample);
  elements.clearButton.addEventListener("click", clearInputs);
  elements.copyButton.addEventListener("click", copyResults);
  elements.exportButton.addEventListener("click", exportCsv);
  elements.copyCommitmentButton.addEventListener("click", copyCommitment);
  elements.exportCommitmentButton.addEventListener("click", exportPublicReceipt);
  elements.confirmPublishedButton.addEventListener("click", confirmPublishedCommitment);
  elements.exportAuditButton.addEventListener("click", exportFinalAudit);
  elements.backupExportButton.addEventListener("click", downloadCompleteBackup);
  elements.backupImportButton.addEventListener("click", function chooseBackupFile() {
    if (state.revealing || state.generating || state.importing) {
      setStatus("正在生成、抽取或导入，请等待本次操作完成后再导入备份。");
      return;
    }
    elements.backupFileInput.click();
  });
  elements.backupFileInput.addEventListener("change", importCompleteBackup);
  elements.archiveList.addEventListener("click", function archiveClick(event) {
    const button = event.target.closest("button[data-archive-action]");
    if (!button || button.disabled) return;
    if (button.dataset.archiveAction === "restore") restoreArchive(button.dataset.sessionId);
    if (button.dataset.archiveAction === "export") exportArchiveCsv(button.dataset.sessionId);
  });
  elements.stage.addEventListener("click", function stageClick(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.paper !== undefined) revealPaper(Number(button.dataset.paper));
    if (button.dataset.week !== undefined) {
      state.activeWeek = Number(button.dataset.week);
      renderStage();
      saveState();
    }
    if (button.dataset.action === "reveal-week") revealWeek();
    if (button.dataset.action === "previous") {
      state.activeWeek = Math.max(0, state.activeWeek - 1);
      renderStage();
      saveState();
    }
    if (button.dataset.action === "next") {
      state.activeWeek = Math.min(state.schedule.weeks.length - 1, state.activeWeek + 1);
      renderStage();
      saveState();
    }
  });

  window.addEventListener("storage", function syncHistoryAcrossTabs(event) {
    if (event.key !== HISTORY_STORAGE_KEY && event.key !== PREVIOUS_HISTORY_STORAGE_KEY &&
        event.key !== V4_HISTORY_STORAGE_KEY &&
        event.key !== LEGACY_HISTORY_STORAGE_KEY) return;
    try {
      const stored = readArchivesFromStorage();
      state.archives = History.mergeSessions(state.archives, stored, verifyStoredSchedule);
      if (state.schedule && state.sessionId) {
        const currentArchive = state.archives.find(function matchingArchive(session) {
          return session.id === state.sessionId && History.sameSchedulePlan(session.schedule, state.schedule);
        });
        if (currentArchive) state.schedule = History.clone(currentArchive.schedule);
      }
      state.historyWriteBlocked = false;
      state.blockedHistoryRaw = null;
      state.blockedHistorySources = [];
      renderArchives();
      renderStage();
      renderTransparency();
      renderHistory();
      renderStats();
      saveState();
      setStatus("另一窗口更新了历史存档，本页已同步显示。");
    } catch (error) {
      captureHistoryFailure(error);
      renderArchives();
      setStatus("另一窗口写入的历史无法安全读取，本页已停止覆盖它。");
    }
  });

  loadArchives();
  loadState();
  ensureCurrentArchive();
  renderAll();
})();
