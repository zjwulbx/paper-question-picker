(function runApplication() {
  "use strict";

  const Core = globalThis.LotteryCore;
  const History = globalThis.HistoryCore;
  const STORAGE_KEY = "paper-question-picker-web-v1";
  const HISTORY_STORAGE_KEY = "paper-question-picker-history-v1";
  const EXAMPLE_STUDENTS = [
    "陈晨", "林一凡", "周子涵", "宋雨桐", "许嘉宁", "赵可心",
    "王启明", "李思远", "张若琳", "吴安然", "郑书言", "何清越",
  ].join("\n");
  const EXAMPLE_PAPERS = [
    "大语言模型的涌现能力", "检索增强生成方法", "多智能体协作机制",
    "思维链提示的可靠性", "小样本学习的新进展", "模型对齐与人类反馈",
    "知识蒸馏的实践路径", "长上下文建模方法", "视觉语言模型评测",
    "智能体工具使用能力", "合成数据与模型训练", "可解释人工智能研究",
  ].join("\n");

  const elements = {
    studentsInput: document.querySelector("#students-input"),
    papersInput: document.querySelector("#papers-input"),
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
    archiveSection: document.querySelector("#archive-section"),
    archiveCount: document.querySelector("#archive-count"),
    archiveList: document.querySelector("#archive-list"),
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
    sessionId: null,
    archives: [],
  };

  function parseLines(value) {
    return value.split(/\r?\n/).map(function trimLine(line) { return line.trim(); }).filter(Boolean);
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
      const normalized = item.toLocaleLowerCase("zh-CN");
      if (seen.has(normalized)) duplicates.add(item);
      seen.add(normalized);
    });
    return Array.from(duplicates);
  }

  function arraysEqual(left, right) {
    return left.length === right.length && left.every(function same(item, index) { return item === right[index]; });
  }

  function validation() {
    const students = parseLines(elements.studentsInput.value);
    const papers = parseLines(elements.papersInput.value);
    const duplicateStudents = findDuplicates(students);
    const duplicatePapers = findDuplicates(papers);
    const errors = [];
    if (students.length < 9) errors.push("至少需要 9 名学生，才能保证同一周 9 人不重复。");
    if (students.length % 3 !== 0) errors.push("学生人数必须是 3 的倍数。");
    if (papers.length !== students.length) {
      errors.push("论文数需与学生数一致：当前 " + students.length + " 名学生、" + papers.length + " 篇论文。");
    }
    if (duplicateStudents.length) errors.push("学生名单有重名：" + duplicateStudents.join("、") + "。请增加标识以便区分。");
    if (duplicatePapers.length) errors.push("论文列表有重复项：" + duplicatePapers.join("、") + "。");
    return { students: students, papers: papers, errors: errors };
  }

  function setStatus(message) {
    elements.liveStatus.textContent = "";
    window.setTimeout(function announce() { elements.liveStatus.textContent = message; }, 10);
    elements.visibleStatusText.textContent = message;
    elements.visibleStatus.hidden = !message;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        studentText: elements.studentsInput.value,
        paperText: elements.papersInput.value,
        schedule: state.schedule,
        activeWeek: state.activeWeek,
        sessionId: state.sessionId,
      }));
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
    };
  }

  function readArchivesFromStorage() {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return [];
      return History.normalizeSessions(JSON.parse(raw), Core.verifySchedule);
    } catch (_error) {
      return [];
    }
  }

  function loadArchives() {
    try {
      const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
      if (!raw) return;
      state.archives = History.normalizeSessions(JSON.parse(raw), Core.verifySchedule);
    } catch (_error) {
      state.archives = [];
      setStatus("部分历史存档无法读取，当前抽签进度未受影响。");
    }
  }

  function persistArchives(candidateSessions) {
    const normalized = History.normalizeSessions(candidateSessions, Core.verifySchedule);
    let sessionsToSave = normalized.slice();
    while (sessionsToSave.length) {
      try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({
          schemaVersion: History.SCHEMA_VERSION,
          sessions: sessionsToSave,
        }));
        state.archives = sessionsToSave;
        if (sessionsToSave.length < normalized.length) {
          setStatus("浏览器存储空间有限，已保留最近 " + sessionsToSave.length + " 次历史存档。");
        }
        return true;
      } catch (_error) {
        if (sessionsToSave.length === 1) return false;
        sessionsToSave = sessionsToSave.slice(0, -1);
      }
    }
    return false;
  }

  function recordHistory(type, description) {
    if (!state.schedule) return false;
    try {
      const merged = History.mergeSessions(state.archives, readArchivesFromStorage(), Core.verifySchedule);
      const update = History.upsertSession(merged, currentSnapshot(), type && description ? {
        type: type,
        description: description,
      } : null, Core.verifySchedule, { sessionId: state.sessionId });
      if (!persistArchives(update.sessions)) {
        setStatus("历史存档写入失败，请先导出当前结果或释放浏览器存储空间。");
        return false;
      }
      state.sessionId = update.sessionId;
      return true;
    } catch (_error) {
      setStatus("历史存档写入失败，当前抽签进度仍然保留。");
      return false;
    }
  }

  function ensureCurrentArchive() {
    if (!state.schedule) return;
    const hasSession = Boolean(state.sessionId && state.archives.some(function sameSession(session) {
      return session.id === state.sessionId;
    }));
    if (!hasSession) state.sessionId = null;
    const description = hasSession ? null : "已自动保存原有抽签进度";
    if (recordHistory(description ? "migrate" : null, description)) saveState();
  }

  function loadState() {
    elements.studentsInput.value = EXAMPLE_STUDENTS;
    elements.papersInput.value = EXAMPLE_PAPERS;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const studentText = typeof saved.studentText === "string" ? saved.studentText : EXAMPLE_STUDENTS;
      const paperText = typeof saved.paperText === "string" ? saved.paperText : EXAMPLE_PAPERS;
      elements.studentsInput.value = studentText;
      elements.papersInput.value = paperText;
      if (!Core.verifySchedule(saved.schedule)) return;
      const names = saved.schedule.students.map(function getName(student) { return student.name; });
      const papers = saved.schedule.weeks.flatMap(function getPapers(week) {
        return week.assignments.map(function getPaper(assignment) { return assignment.paper; });
      });
      if (!arraysEqual(parseLines(studentText), names) || !arraysEqual(parseLines(paperText), papers)) return;
      state.schedule = saved.schedule;
      const restoredWeek = Number(saved.activeWeek);
      state.activeWeek = Number.isFinite(restoredWeek)
        ? Math.min(Math.max(Math.floor(restoredWeek), 0), saved.schedule.weeks.length - 1)
        : 0;
      state.sessionId = typeof saved.sessionId === "string" ? saved.sessionId : null;
    } catch (_error) {
      setStatus("之前保存的当前进度无法读取，但历史存档仍可单独恢复。");
    }
  }

  function refreshInputs() {
    const result = validation();
    elements.studentCount.textContent = result.students.length + " 人";
    elements.paperCount.textContent = result.papers.length + " 篇";
    elements.metricStudents.textContent = result.students.length;
    elements.metricPapers.textContent = result.papers.length;
    elements.metricWeeks.textContent = result.students.length >= 3 && result.students.length % 3 === 0
      ? result.students.length / 3
      : "—";

    if (!state.schedule) {
      const valid = result.errors.length === 0;
      elements.settingsBadge.className = "badge " + (valid ? "success" : "danger");
      elements.settingsBadge.textContent = valid ? "✓ 可开始" : "! 待完善";
      elements.generateButton.disabled = !valid;
      elements.validationBox.hidden = valid;
      elements.validationBox.innerHTML = valid
        ? ""
        : "<strong>还不能开始抽签</strong><ul>" + result.errors.map(function errorItem(error) {
            return "<li>" + escapeHtml(error) + "</li>";
          }).join("") + "</ul>";
    }
    saveState();
  }

  function setLocked(locked) {
    elements.studentsInput.disabled = locked;
    elements.papersInput.disabled = locked;
    elements.generateButton.hidden = locked;
    elements.editButton.hidden = !locked;
    elements.inputActions.hidden = locked;
    elements.resetTop.disabled = !locked;
    elements.validationBox.hidden = locked || validation().errors.length === 0;
    elements.settingsSubtitle.textContent = locked ? "本次抽签名单已锁定" : "每行输入一位学生和一篇论文";
    elements.settingsBadge.className = "badge " + (locked ? "neutral" : "success");
    elements.settingsBadge.textContent = locked ? "▣ 已锁定" : "✓ 可开始";
    elements.saveNote.textContent = locked
      ? "抽签结果与进度已自动保存在这台电脑。"
      : "系统先生成全程安排，确保后续不会出现无解。";
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
              <div class="slots">${[1, 2, 3].map(function slot(value) {
                return `<div class="slot waiting"><span>${value}</span>等待抽取</div>`;
              }).join("")}</div>
              <button class="button outline wide" type="button" disabled>抽取 3 人</button>
            </article>`;
          }).join("")}
        </div>
        <div class="principle"><strong>公平原则：</strong>每周优先从累计次数最少的学生中抽取；同次数学生随机竞争名额。</div>
      </div>`;
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
    const unlockedThrough = firstIncompleteWeek();
    const revealDisabled = Boolean(state.revealing);

    const completionBanner = completeAll
      ? `<div class="completion-banner"><span class="trophy" aria-hidden="true">★</span><div><h2>全部抽签完成</h2><p>${state.schedule.students.length} 篇论文已全部揭晓，每位学生恰好被抽中 3 次。</p></div></div>`
      : "";

    elements.stage.innerHTML = `${completionBanner}
      <section class="card stage-card">
        <div class="stage-head">
          <div class="week-title"><span class="week-number">${state.activeWeek + 1}</span><div><h2>第 ${state.activeWeek + 1} 周</h2><p>3 篇论文 · 9 个提问名额 · 同周不重复</p></div></div>
          <button class="button outline" type="button" data-action="reveal-week" ${weekComplete || revealDisabled ? "disabled" : ""}>
            <span aria-hidden="true">✦</span> ${weekComplete ? "本周已揭晓" : "全部揭晓本周"}
          </button>
        </div>
        <div class="week-tabs" aria-label="周次导航">
          ${state.schedule.weeks.map(function weekTab(item, index) {
            const complete = item.revealed.every(Boolean);
            const accessible = completeAll || index <= unlockedThrough;
            const className = index === state.activeWeek ? "active" : complete ? "complete" : "";
            return `<button type="button" data-week="${index}" class="week-tab ${className}" ${!accessible || revealDisabled ? "disabled" : ""} ${index === state.activeWeek ? 'aria-current="step"' : ""}>${complete ? "✓ " : ""}第 ${index + 1} 周</button>`;
          }).join("")}
        </div>
      </section>

      <section class="paper-grid">
        ${week.assignments.map(function assignmentCard(assignment, paperIndex) {
          const revealed = week.revealed[paperIndex];
          const revealing = state.revealing === "all" || state.revealing === state.activeWeek + "-" + paperIndex;
          const slots = assignment.studentIds.map(function slot(studentId, slotIndex) {
            const content = revealed ? escapeHtml(names[studentId]) : revealing ? "正在抽取…" : "等待抽取";
            return `<div class="slot ${revealed ? "revealed" : revealing ? "shuffling" : "waiting"}"><span>${revealed ? "✓" : slotIndex + 1}</span><b>${content}</b></div>`;
          }).join("");
          return `<article class="paper-card ${revealed ? "is-revealed" : ""}">
            <div class="paper-top"><span class="paper-kicker">论文 ${String(state.activeWeek * 3 + paperIndex + 1).padStart(2, "0")}</span><span class="badge ${revealed ? "success" : "neutral"}">${revealed ? "✓ 已揭晓" : revealing ? "抽取中" : "待揭晓"}</span></div>
            <h3>${escapeHtml(assignment.paper)}</h3>
            <div class="slots">${slots}</div>
            <button class="button ${revealed ? "soft" : "outline"} wide" type="button" data-paper="${paperIndex}" ${revealed || revealDisabled ? "disabled" : ""}>${revealed ? "✓ 抽取完成" : revealing ? "正在抽取…" : "⚄ 抽取 3 人"}</button>
          </article>`;
        }).join("")}
      </section>

      <section class="week-progress">
        <div class="progress-row">
          <div><strong>本周进度 <em>${week.revealed.filter(Boolean).length} / 3 篇</em></strong><p>${weekComplete ? "本周 9 位同学互不重复，可以继续。" : "抽完三篇论文后即可进入下一周。"}</p></div>
          <div class="progress-actions">
            <button class="button outline icon-button" type="button" data-action="previous" aria-label="上一周" ${state.activeWeek === 0 || revealDisabled ? "disabled" : ""}>‹</button>
            ${state.activeWeek < state.schedule.weeks.length - 1
              ? `<button class="button primary" type="button" data-action="next" ${!weekComplete || revealDisabled ? "disabled" : ""}>下一周 ›</button>`
              : `<span class="final-status ${completeAll ? "done" : ""}">${completeAll ? "✓ 全部完成" : "▣ 完成本周"}</span>`}
          </div>
        </div>
        <div class="progress-track"><span style="width:${week.revealed.filter(Boolean).length / 3 * 100}%"></span></div>
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
    elements.historyContent.innerHTML = `<div class="table-scroll"><table><thead><tr><th>周次</th><th>论文</th><th>提问学生</th></tr></thead><tbody>${rows.map(function historyRow(row) {
      return `<tr><td>第 ${row.week} 周</td><td><strong>${escapeHtml(row.paper)}</strong></td><td><div class="name-tags">${row.names.map(function nameTag(name) { return `<span>${escapeHtml(name)}</span>`; }).join("")}</div></td></tr>`;
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
    return `<div class="table-scroll archive-table"><table><thead><tr><th>周次</th><th>论文</th><th>提问学生</th></tr></thead><tbody>${rows.map(function archiveRow(row) {
      return `<tr><td>第 ${row.week} 周</td><td><strong>${escapeHtml(row.paper)}</strong></td><td><div class="name-tags">${row.names.map(function archiveName(name) {
        return `<span>${escapeHtml(name)}</span>`;
      }).join("")}</div></td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  function renderArchives() {
    const archives = state.archives;
    elements.archiveSection.hidden = archives.length === 0;
    elements.archiveCount.textContent = archives.length + " 次";
    if (!archives.length) {
      elements.archiveList.innerHTML = "";
      return;
    }

    elements.archiveList.innerHTML = archives.map(function archiveCard(session) {
      const rows = History.getVisibleRows(session.schedule);
      const totalPapers = session.schedule.students.length;
      const revealedPapers = rows.length;
      const isCurrent = Boolean(state.schedule && state.sessionId === session.id);
      const complete = revealedPapers === totalPapers;
      const operations = session.operations.slice().reverse();
      const statusClass = complete ? "success" : isCurrent ? "current" : "neutral";
      const statusText = complete ? "✓ 已完成" : isCurrent ? "● 当前进度" : "可恢复";
      return `<article class="archive-item ${isCurrent ? "is-current" : ""}">
        <div class="archive-overview">
          <div class="archive-mark" aria-hidden="true">${complete ? "✓" : "↶"}</div>
          <div class="archive-summary">
            <strong>${escapeHtml(formatArchiveTime(session.createdAt, false))} 的抽签</strong>
            <p>${totalPapers} 名学生 · ${totalPapers} 篇论文 · 已揭晓 ${revealedPapers}/${totalPapers} 篇</p>
            <span>最后操作：${escapeHtml(formatArchiveTime(session.updatedAt, true))}</span>
          </div>
          <span class="archive-status ${statusClass}">${statusText}</span>
        </div>
        <div class="archive-actions">
          <button class="button outline small" type="button" data-archive-action="restore" data-session-id="${session.id}" ${isCurrent ? "disabled" : ""}>${isCurrent ? "正在使用" : "恢复此进度"}</button>
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
      return `<div class="student-stat"><strong>${escapeHtml(student.name)}</strong><span class="count-dots" aria-hidden="true">${dots}</span><b>${count}/3</b></div>`;
    }).join("");
  }

  function renderAll() {
    setLocked(Boolean(state.schedule));
    refreshInputs();
    renderStage();
    renderArchives();
    renderHistory();
    renderStats();
  }

  function generateSchedule() {
    const result = validation();
    if (result.errors.length || state.revealing) return;
    elements.generateButton.disabled = true;
    elements.studentsInput.disabled = true;
    elements.papersInput.disabled = true;
    elements.exampleButton.disabled = true;
    elements.clearButton.disabled = true;
    elements.generateButton.innerHTML = '<span class="pulse" aria-hidden="true">✦</span> 正在平衡分配…';
    setStatus("正在平衡全课程安排…");
    state.timer = window.setTimeout(function finishGenerate() {
      try {
        state.schedule = Core.createSchedule(result.students, result.papers);
        state.activeWeek = 0;
        state.sessionId = null;
        const savedToHistory = recordHistory("generate", "生成完整抽签安排");
        setStatus(savedToHistory
          ? "安排已生成并存入历史：" + state.schedule.weeks.length + " 周，每人最终恰好 3 次。"
          : "安排已生成，但历史存档暂时无法写入；当前进度仍会单独保存。");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "生成失败，请检查输入。");
      }
      elements.generateButton.innerHTML = '<span aria-hidden="true">⚄</span> 生成完整抽签';
      elements.exampleButton.disabled = false;
      elements.clearButton.disabled = false;
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
    if (!week || week.revealed[paperIndex] || state.revealing) return;
    const assignment = week.assignments[paperIndex];
    const names = getNameMap();
    state.revealing = state.activeWeek + "-" + paperIndex;
    setStatus("正在为《" + assignment.paper + "》抽取提问同学…");
    renderStage();
    state.timer = window.setTimeout(function finishReveal() {
      updateRevealed([paperIndex]);
      state.revealing = null;
      state.timer = null;
      const selectedNames = assignment.studentIds.map(function name(id) { return names[id]; });
      const savedToHistory = recordHistory(
        "reveal-paper",
        "揭晓《" + assignment.paper + "》：" + selectedNames.join("、"),
      );
      setStatus(savedToHistory
        ? "抽取完成并已记录：" + selectedNames.join("、") + "。"
        : "抽取完成：" + selectedNames.join("、") + "。当前进度已保留，但历史记录写入失败。");
      renderAll();
      saveState();
    }, 900);
  }

  function revealWeek() {
    const week = state.schedule && state.schedule.weeks[state.activeWeek];
    if (!week || week.revealed.every(Boolean) || state.revealing) return;
    const pending = week.revealed.map(function pendingIndex(value, index) { return value ? -1 : index; }).filter(function valid(index) { return index >= 0; });
    state.revealing = "all";
    setStatus("正在揭晓第 " + (state.activeWeek + 1) + " 周剩余结果…");
    renderStage();
    state.timer = window.setTimeout(function finishWeek() {
      updateRevealed(pending);
      state.revealing = null;
      state.timer = null;
      const weekNumber = state.activeWeek + 1;
      const savedToHistory = recordHistory(
        "reveal-week",
        "批量揭晓第 " + weekNumber + " 周剩余 " + pending.length + " 篇论文",
      );
      setStatus(savedToHistory
        ? "第 " + weekNumber + " 周已全部揭晓并记录，9 位同学互不重复。"
        : "第 " + weekNumber + " 周已全部揭晓；当前进度已保留，但历史记录写入失败。");
      renderAll();
      saveState();
    }, 900);
  }

  function resetResults() {
    if (!state.schedule || state.revealing) return;
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
    elements.studentsInput.value = EXAMPLE_STUDENTS;
    elements.papersInput.value = EXAMPLE_PAPERS;
    setStatus("已载入 12 人、12 篇论文的示例。");
    renderAll();
  }

  function clearInputs() {
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
      return "第 " + row.week + " 周｜" + row.paper + "｜" + row.names.join("、");
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
      ["周次", "论文", "提问学生 1", "提问学生 2", "提问学生 3"],
    ].concat(rows.map(function csvRow(row) {
      return ["第 " + row.week + " 周", row.paper].concat(row.names);
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

  function restoreArchive(sessionId) {
    const selected = state.archives.find(function findSession(item) { return item.id === sessionId; });
    if (!selected || !Core.verifySchedule(selected.schedule) || state.revealing) return;
    if (state.schedule && state.sessionId === selected.id) return;
    if (!window.confirm("确定恢复 " + formatArchiveTime(selected.createdAt, false) + " 的抽签进度吗？当前界面内容会被替换。")) return;

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
    if (event.key !== HISTORY_STORAGE_KEY) return;
    state.archives = History.mergeSessions(state.archives, readArchivesFromStorage(), Core.verifySchedule);
    renderArchives();
    setStatus("另一窗口更新了历史存档，本页已同步显示。");
  });

  loadArchives();
  loadState();
  ensureCurrentArchive();
  renderAll();
})();
