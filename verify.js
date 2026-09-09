(function initializeAuditVerifier(root) {
  "use strict";

  const MAX_FILE_BYTES = 64 * 1024 * 1024;
  const documentRef = root && root.document;
  if (!documentRef) return;

  const elements = {
    liveStatus: documentRef.getElementById("live-status"),
    receiptButton: documentRef.getElementById("receipt-file-button"),
    receiptInput: documentRef.getElementById("receipt-file-input"),
    receiptStatus: documentRef.getElementById("receipt-file-status"),
    reportButton: documentRef.getElementById("audit-file-button"),
    reportInput: documentRef.getElementById("audit-file-input"),
    reportStatus: documentRef.getElementById("audit-file-status"),
    verifyButton: documentRef.getElementById("verify-audit-button"),
    result: documentRef.getElementById("verification-result"),
  };

  if (Object.values(elements).some(function missing(element) { return !element; })) return;

  const state = {
    receipt: null,
    report: null,
    receiptSequence: 0,
    reportSequence: 0,
  };

  function announce(message) {
    elements.liveStatus.textContent = String(message || "");
  }

  function clearResult() {
    elements.result.replaceChildren();
    elements.result.hidden = true;
    delete elements.result.dataset.state;
  }

  function setFileStatus(kind, stateName, message) {
    const target = kind === "receipt" ? elements.receiptStatus : elements.reportStatus;
    target.dataset.state = stateName;
    target.textContent = message;
  }

  function updateVerifyButton() {
    elements.verifyButton.disabled = !(state.receipt && state.report);
  }

  function coreApi() {
    const api = root.AuditCore;
    if (
      !api ||
      typeof api.parsePublicReceipt !== "function" ||
      typeof api.parseFinalReport !== "function" ||
      typeof api.verifyReceiptAndReport !== "function"
    ) {
      const error = new Error("验证核心没有正确载入，请刷新页面后重试。");
      error.code = "AUDIT_CORE_UNAVAILABLE";
      throw error;
    }
    return api;
  }

  function errorDetails(error, fallback) {
    const code = error && typeof error.code === "string" ? error.code : "INVALID_FILE";
    const message = error && typeof error.message === "string" && error.message.trim()
      ? error.message.trim()
      : fallback;
    return { code: code, message: message };
  }

  function byteLength(text) {
    if (typeof root.TextEncoder === "function") {
      return new root.TextEncoder().encode(text).byteLength;
    }
    if (typeof TextEncoder === "function") {
      return new TextEncoder().encode(text).byteLength;
    }
    if (typeof Blob === "function") return new Blob([text]).size;
    return text.length;
  }

  async function readJsonFile(file) {
    if (!file || typeof file.text !== "function") {
      const unsupported = new Error("浏览器无法读取这个文件。");
      unsupported.code = "FILE_READ_UNSUPPORTED";
      throw unsupported;
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      const invalidSize = new Error("无法确认文件大小。");
      invalidSize.code = "INVALID_FILE_SIZE";
      throw invalidSize;
    }
    if (file.size > MAX_FILE_BYTES) {
      const tooLarge = new Error("文件超过 64 MiB 上限。");
      tooLarge.code = "FILE_TOO_LARGE";
      throw tooLarge;
    }

    let text = await file.text();
    if (typeof text !== "string") {
      const invalidContent = new Error("文件内容不是文本。");
      invalidContent.code = "INVALID_FILE_CONTENT";
      throw invalidContent;
    }
    if (byteLength(text) > MAX_FILE_BYTES) {
      const decodedTooLarge = new Error("文件解码后超过 64 MiB 上限。");
      decodedTooLarge.code = "FILE_TOO_LARGE";
      throw decodedTooLarge;
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    try {
      return JSON.parse(text);
    } catch (_error) {
      const invalidJson = new Error("文件不是有效的 JSON。");
      invalidJson.code = "INVALID_JSON";
      throw invalidJson;
    }
  }

  function displayName(file) {
    return file && typeof file.name === "string" && file.name.trim()
      ? file.name.trim()
      : "未命名文件";
  }

  async function loadEvidence(kind, file) {
    const sequenceKey = kind === "receipt" ? "receiptSequence" : "reportSequence";
    const sequence = state[sequenceKey] + 1;
    state[sequenceKey] = sequence;
    state[kind] = null;
    clearResult();
    updateVerifyButton();

    if (!file) {
      setFileStatus(kind, "empty", "尚未选择文件");
      announce(kind === "receipt" ? "尚未选择公开承诺文件。" : "尚未选择完整审计文件。");
      return;
    }

    const name = displayName(file);
    setFileStatus(kind, "empty", name + " · 正在检查…");

    try {
      const candidate = await readJsonFile(file);
      if (sequence !== state[sequenceKey]) return;
      const api = coreApi();
      const parsed = kind === "receipt"
        ? api.parsePublicReceipt(candidate)
        : api.parseFinalReport(candidate);
      if (!parsed || typeof parsed !== "object") {
        const invalidParsed = new Error("验证核心没有返回有效数据。");
        invalidParsed.code = "INVALID_PARSED_FILE";
        throw invalidParsed;
      }
      state[kind] = parsed;
      setFileStatus(
        kind,
        "success",
        name + (kind === "receipt" ? " · 公开承诺有效" : " · 完整审计报告有效"),
      );
      announce(name + " 已通过格式检查。");
    } catch (error) {
      if (sequence !== state[sequenceKey]) return;
      const details = errorDetails(error, "文件检查失败。");
      state[kind] = null;
      setFileStatus(kind, "error", name + " · " + details.message);
      announce(name + " 检查失败：" + details.message);
    }
    updateVerifyButton();
  }

  function appendHeading(container, text) {
    const heading = documentRef.createElement("h2");
    heading.textContent = text;
    container.appendChild(heading);
  }

  function appendParagraph(container, text) {
    const paragraph = documentRef.createElement("p");
    paragraph.textContent = text;
    container.appendChild(paragraph);
  }

  function appendCodeParagraph(container, label, value) {
    if (value === undefined || value === null || value === "") return;
    const paragraph = documentRef.createElement("p");
    const strong = documentRef.createElement("strong");
    const code = documentRef.createElement("code");
    strong.textContent = label + "：";
    code.textContent = String(value);
    paragraph.appendChild(strong);
    paragraph.appendChild(code);
    container.appendChild(paragraph);
  }

  function ownValue(object, key) {
    return object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key)
      ? object[key]
      : undefined;
  }

  function firstValue(values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return undefined;
  }

  function normalizedCheck(label, value, detail) {
    return {
      label: String(label || "检查项"),
      ok: value === true,
      detail: detail === undefined || detail === null ? "" : String(detail),
    };
  }

  function checksFromOutcome(outcome) {
    const checks = [];
    const provided = ownValue(outcome, "checks");
    if (Array.isArray(provided)) {
      provided.forEach(function addProvided(item, index) {
        if (typeof item === "string") {
          checks.push(normalizedCheck(item, true));
        } else if (item && typeof item === "object") {
          checks.push(normalizedCheck(
            firstValue([item.label, item.name, item.message, "检查项 " + (index + 1)]),
            item.ok === undefined ? item.passed : item.ok,
            item.detail,
          ));
        }
      });
    } else if (provided && typeof provided === "object") {
      Object.keys(provided).forEach(function addNamed(key) {
        const value = provided[key];
        if (value && typeof value === "object") {
          checks.push(normalizedCheck(firstValue([value.label, key]), firstValue([value.ok, value.passed]), value.detail));
        } else {
          checks.push(normalizedCheck(key, value));
        }
      });
    }

    [
      ["receiptMatches", "事前公开凭证与最终报告一致"],
      ["inputDigestMatches", "规范化输入摘要一致"],
      ["hashMatches", "规范化输入摘要一致"],
      ["commitmentMatches", "随机种子与承诺一致"],
      ["reportedPlanDigestMatches", "报告中的完整计划摘要正确"],
      ["replayPlanDigestMatches", "重放计划摘要与报告一致"],
      ["replayMatches", "随机种子重放得到同一完整计划"],
      ["scheduleMatches", "随机种子重放得到同一完整计划"],
      ["complete", "所有论文均已完成揭晓"],
    ].forEach(function addKnown(entry) {
      const value = ownValue(outcome, entry[0]);
      if (typeof value === "boolean") checks.push(normalizedCheck(entry[1], value));
    });
    return checks;
  }

  function deriveFairnessChecks(report) {
    const input = ownValue(report, "input") || {
      students: ownValue(report, "students"),
      papers: ownValue(report, "papers"),
    };
    const plan = ownValue(report, "plan");
    const students = input && Array.isArray(input.students) ? input.students : null;
    const courseWeeks = Array.isArray(ownValue(report, "courseWeeks")) ? report.courseWeeks : null;
    const papers = input && Array.isArray(input.papers)
      ? input.papers
      : courseWeeks ? courseWeeks.flatMap(function paperList(week) { return Array.isArray(week.papers) ? week.papers : []; }) : null;
    const planWeeks = plan && Array.isArray(plan.weeks) ? plan.weeks : null;
    if (!students || !papers || !planWeeks) return [];

    const receipt = ownValue(report, "receipt") || {};
    const version = ownValue(report, "version");
    const isV7 = version === 7;
    const isVariableWeek = version === 6 || isV7;
    const expectedWeekSizes = isVariableWeek && Array.isArray(receipt.weekPaperCounts)
      ? receipt.weekPaperCounts.slice()
      : new Array(planWeeks.length).fill(3);
    const totals = new Array(students.length).fill(0);
    const presentationTotals = new Array(students.length).fill(0);
    let paperSlots = 0;
    let paperCursor = 0;
    let weeklyShape = true;
    let presenterShape = true;
    let weeklyRoleSeparation = true;
    let presenterMode = null;

    planWeeks.forEach(function inspectWeek(week, weekIndex) {
      const weekSize = expectedWeekSizes[weekIndex];
      if (!week || week.weekIndex !== weekIndex || (weekSize !== 3 && weekSize !== 4) ||
          !Array.isArray(week.assignments) || week.assignments.length !== weekSize) {
        weeklyShape = false;
        return;
      }
      const weeklyIndexes = [];
      const weeklyPresenters = [];
      week.assignments.forEach(function inspectAssignment(assignment, paperOffset) {
        paperSlots += 1;
        if (!assignment || assignment.paperIndex !== paperCursor + paperOffset ||
            !Array.isArray(assignment.studentIndexes) || assignment.studentIndexes.length !== 3) {
          weeklyShape = false;
          return;
        }
        assignment.studentIndexes.forEach(function countIndex(index) {
          weeklyIndexes.push(index);
          if (!Number.isInteger(index) || index < 0 || index >= students.length) weeklyShape = false;
          else totals[index] += 1;
        });
        const hasPresenter = Object.prototype.hasOwnProperty.call(assignment, "presenterIndex");
        if (presenterMode === null) presenterMode = hasPresenter;
        if (presenterMode !== hasPresenter) presenterShape = false;
        if (hasPresenter) {
          if (!Number.isInteger(assignment.presenterIndex) || assignment.presenterIndex < 0 ||
              assignment.presenterIndex >= students.length || assignment.studentIndexes.includes(assignment.presenterIndex)) {
            presenterShape = false;
          } else {
            presentationTotals[assignment.presenterIndex] += 1;
            weeklyPresenters.push(assignment.presenterIndex);
          }
        }
      });
      if (weeklyIndexes.length !== weekSize * 3 || new Set(weeklyIndexes).size !== weekSize * 3) weeklyShape = false;
      if (isV7 && (weeklyPresenters.length !== weekSize || new Set(weeklyPresenters).size !== weekSize ||
          weeklyPresenters.some(function overlap(index) { return weeklyIndexes.includes(index); }))) {
        weeklyRoleSeparation = false;
      }
      paperCursor += weekSize;
    });

    const countShape = students.length === papers.length && students.length >= (isV7 ? 12 : 9) &&
      expectedWeekSizes.length === planWeeks.length && paperSlots === papers.length &&
      expectedWeekSizes.reduce(function sum(total, size) { return total + size; }, 0) === papers.length &&
      (isV7
        ? Math.max.apply(null, expectedWeekSizes) * 4 <= students.length
        : version === 6
          ? Math.max.apply(null, expectedWeekSizes) * 3 <= students.length
          : students.length % 3 === 0);

    const checks = [
      normalizedCheck("学生数与论文数相等，且人数符合规则", countShape),
      normalizedCheck(isVariableWeek
        ? "每周 3 或 4 篇、每篇 3 位提问人、同周提问人不重复"
        : "每周 3 篇、每篇 3 位提问人、同周 9 位提问人不重复", weeklyShape),
      normalizedCheck("每位学生在完整安排中恰好提问 3 次",
        totals.every(function three(count) { return count === 3; })),
    ];
    if (presenterMode || !presenterShape) {
      checks.push(
        normalizedCheck("每篇论文恰好有 1 位报告人，且不是本篇提问人", presenterShape),
        normalizedCheck("每位学生在完整安排中恰好报告 1 篇",
          presenterShape && presentationTotals.every(function one(count) { return count === 1; })),
      );
      if (isV7) {
        checks.push(normalizedCheck("同一周内，报告人与全部提问人互不重复", weeklyRoleSeparation));
      }
    }
    return checks;
  }

  function deduplicateChecks(checks) {
    const seen = new Set();
    return checks.filter(function unique(check) {
      if (!check || seen.has(check.label)) return false;
      seen.add(check.label);
      return true;
    });
  }

  function appendChecks(container, checks) {
    if (!checks.length) return;
    const heading = documentRef.createElement("h3");
    heading.textContent = "验证与公平检查";
    container.appendChild(heading);
    const list = documentRef.createElement("ul");
    checks.forEach(function checkItem(check) {
      const item = documentRef.createElement("li");
      item.textContent = (check.ok ? "✓ " : "✗ ") + check.label +
        (check.detail ? " — " + check.detail : "");
      list.appendChild(item);
    });
    container.appendChild(list);
  }

  function appendReplayDetails(container, outcome, report) {
    const students = Array.isArray(report.students) ? report.students : [];
    const courseWeeks = Array.isArray(report.courseWeeks) ? report.courseWeeks : null;
    const papers = Array.isArray(report.papers)
      ? report.papers
      : courseWeeks ? courseWeeks.flatMap(function weekPapers(week) { return Array.isArray(week.papers) ? week.papers : []; }) : [];
    const replayedPlan = ownValue(outcome, "replayedPlan");
    const plan = replayedPlan && Array.isArray(replayedPlan.weeks)
      ? replayedPlan
      : ownValue(report, "plan");
    if (!students.length || !papers.length || !plan || !Array.isArray(plan.weeks)) return;

    const details = documentRef.createElement("details");
    details.className = "replay-details";
    const summary = documentRef.createElement("summary");
    summary.textContent = "查看规范化输入与重放后的完整安排（" + papers.length + " 篇）";
    details.appendChild(summary);

    let populated = false;
    details.addEventListener("toggle", function populateReplay() {
      if (!details.open || populated) return;
      populated = true;
      const note = documentRef.createElement("p");
      note.className = "replay-privacy";
      note.textContent = "以下内容含完整实名安排，仅用于班级内核对。方括号内是协议使用的零基下标。";
      details.appendChild(note);

      const lines = ["规范化学生名单"];
      students.forEach(function studentLine(name, index) {
        lines.push("[" + index + "] " + name);
      });
      lines.push("", "规范化论文与重放安排");
      plan.weeks.forEach(function weekLines(week, weekIndex) {
        const label = courseWeeks && courseWeeks[weekIndex] && typeof courseWeeks[weekIndex].label === "string"
          ? courseWeeks[weekIndex].label
          : "第 " + (weekIndex + 1) + " 周";
        lines.push("", label);
        week.assignments.forEach(function assignmentLine(assignment) {
          const paperIndex = assignment.paperIndex;
          const selected = assignment.studentIndexes.map(function selectedStudent(studentIndex) {
            return "[" + studentIndex + "] " + students[studentIndex];
          });
          lines.push("[论文 " + paperIndex + "] " + papers[paperIndex]);
          if (Object.prototype.hasOwnProperty.call(assignment, "presenterIndex")) {
            lines.push("  报告：[" + assignment.presenterIndex + "] " + students[assignment.presenterIndex]);
          } else {
            lines.push("  报告：v4 旧协议未分配");
          }
          lines.push("  提问：" + selected.join(" ｜ "));
        });
      });

      const output = documentRef.createElement("pre");
      output.className = "replay-output";
      output.textContent = lines.join("\n");
      details.appendChild(output);
    });
    container.appendChild(details);
  }

  function renderFailure(errorOrOutcome) {
    const details = errorDetails(errorOrOutcome, "验证失败，两份文件不一致或已经损坏。");
    clearResult();
    elements.result.hidden = false;
    elements.result.dataset.state = "error";
    appendHeading(elements.result, "验证未通过");
    appendParagraph(elements.result, details.message);
    appendCodeParagraph(elements.result, "错误代码", details.code);
    const checks = errorOrOutcome && typeof errorOrOutcome === "object"
      ? deduplicateChecks(checksFromOutcome(errorOrOutcome))
      : [];
    appendChecks(elements.result, checks);
    announce("验证未通过：" + details.message);
  }

  function renderSuccess(outcome) {
    const returnedReceipt = ownValue(outcome, "receipt");
    const returnedReport = ownValue(outcome, "report");
    const receipt = returnedReceipt && typeof returnedReceipt === "object"
      ? returnedReceipt
      : state.receipt;
    const report = returnedReport && typeof returnedReport === "object" &&
      (ownValue(returnedReport, "input") || ownValue(returnedReport, "schedule"))
      ? returnedReport
      : state.report;
    const input = ownValue(report, "input") || {
      students: ownValue(report, "students"),
      papers: ownValue(report, "papers"),
    };
    const schedule = ownValue(report, "schedule") || {};
    const students = Array.isArray(input.students) ? input.students : [];
    const courseWeeks = Array.isArray(ownValue(report, "courseWeeks")) ? report.courseWeeks : [];
    const papers = Array.isArray(input.papers)
      ? input.papers
      : courseWeeks.flatMap(function paperList(week) { return Array.isArray(week.papers) ? week.papers : []; });
    const reportPlan = ownValue(report, "plan") || {};
    const weeks = Array.isArray(schedule.weeks)
      ? schedule.weeks
      : Array.isArray(reportPlan.weeks) ? reportPlan.weeks : [];
    const commitment = firstValue([
      ownValue(outcome, "commitment"),
      ownValue(receipt, "commitment"),
      ownValue(report, "commitment"),
    ]);
    const inputDigest = firstValue([
      ownValue(outcome, "inputDigest"),
      ownValue(receipt, "inputDigest"),
      ownValue(report, "inputDigest"),
    ]);
    const planDigest = firstValue([
      ownValue(outcome, "planDigest"),
      ownValue(report, "planDigest"),
      ownValue(schedule, "planDigest"),
    ]);
    const assignmentCount = weeks.reduce(function countAssignments(total, week) {
      return total + (week && Array.isArray(week.assignments) ? week.assignments.length : 0);
    }, 0);
    const hasPresenters = weeks.some(function presenterPlan(week) {
      return week && Array.isArray(week.assignments) && week.assignments.some(function presenterAssignment(assignment) {
        return assignment && Object.prototype.hasOwnProperty.call(assignment, "presenterIndex");
      });
    });
    const planSummary = planDigest ||
      (weeks.length + " 周 · " + assignmentCount + " 篇论文 · " + assignmentCount * 3 +
        " 个提问名额" + (hasPresenters ? " · " + assignmentCount + " 个报告名额" : ""));
    const algorithm = firstValue([
      ownValue(outcome, "algorithmVersion"),
      ownValue(receipt, "algorithmVersion"),
      ownValue(receipt, "protocolId"),
      ownValue(report, "algorithmVersion"),
      ownValue(report, "protocolId"),
    ]);

    const checks = deduplicateChecks(
      checksFromOutcome(outcome).concat(deriveFairnessChecks(report)),
    );

    clearResult();
    elements.result.hidden = false;
    elements.result.dataset.state = "success";
    appendHeading(elements.result, "验证通过");
    appendParagraph(
      elements.result,
      typeof outcome.message === "string" && outcome.message.trim()
        ? outcome.message.trim()
        : "事前承诺、规范输入和完整抽签计划一致。",
    );
    appendCodeParagraph(elements.result, "承诺", commitment);
    appendCodeParagraph(elements.result, "输入摘要", inputDigest);
    appendCodeParagraph(elements.result, "计划摘要", planSummary);
    appendCodeParagraph(elements.result, "算法版本", algorithm);
    appendParagraph(
      elements.result,
      "输入：" + students.length + " 名学生、" + papers.length +
        " 篇有效论文；计划：" + weeks.length + " 周。",
    );
    appendChecks(elements.result, checks);
    appendReplayDetails(elements.result, outcome, report);
    appendParagraph(
      elements.result,
      "请继续核对：展开上方完整安排，与每周截图或群内保存的课堂结果逐项比较；这里证明所选凭证与报告一致，但不能代替课堂见证，提前公开时间也仍以班级群等外部记录为准。",
    );
    announce("本地验证通过。");
  }

  function verifyLoadedEvidence() {
    clearResult();
    if (!state.receipt || !state.report) {
      renderFailure({
        code: "TWO_FILES_REQUIRED",
        message: "必须先载入有效的公开承诺文件和完整审计报告。",
      });
      updateVerifyButton();
      return;
    }

    try {
      const outcome = coreApi().verifyReceiptAndReport(state.receipt, state.report);
      if (outcome === true) {
        renderSuccess({ ok: true, receipt: state.receipt, report: state.report });
      } else if (!outcome || typeof outcome !== "object" || outcome.ok !== true) {
        renderFailure(outcome || {
          code: "INVALID_VERIFICATION_RESULT",
          message: "验证核心没有返回有效结果。",
        });
      } else {
        renderSuccess(outcome);
      }
    } catch (error) {
      renderFailure(error);
    }
  }

  elements.receiptButton.addEventListener("click", function chooseReceipt() {
    elements.receiptInput.value = "";
    elements.receiptInput.click();
  });
  elements.reportButton.addEventListener("click", function chooseReport() {
    elements.reportInput.value = "";
    elements.reportInput.click();
  });
  elements.receiptInput.addEventListener("change", function receiptChanged() {
    void loadEvidence("receipt", elements.receiptInput.files && elements.receiptInput.files[0]);
  });
  elements.reportInput.addEventListener("change", function reportChanged() {
    void loadEvidence("report", elements.reportInput.files && elements.reportInput.files[0]);
  });
  elements.verifyButton.addEventListener("click", verifyLoadedEvidence);

  clearResult();
  updateVerifyButton();
  try {
    coreApi();
  } catch (error) {
    const details = errorDetails(error, "验证核心没有正确载入。");
    setFileStatus("receipt", "error", details.message);
    setFileStatus("report", "error", details.message);
    announce(details.message);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
