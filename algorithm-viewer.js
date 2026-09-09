(function loadProtocolDocument(root) {
  "use strict";

  const output = root.document && root.document.getElementById("protocol-document");
  const status = root.document && root.document.getElementById("protocol-status");
  if (!output || typeof root.fetch !== "function") return;

  root.fetch("ALGORITHM.md", { cache: "no-store", credentials: "same-origin" })
    .then(function ensureSuccess(response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.text();
    })
    .then(function showProtocol(source) {
      output.textContent = source.replace(/^\uFEFF/, "");
      if (status) status.textContent = "协议原文 · 已完整加载";
    })
    .catch(function showFailure() {
      output.textContent = "协议原文加载失败。请点击上方“下载原始 Markdown”，或稍后刷新页面重试。";
      if (status) status.textContent = "协议原文 · 加载失败";
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
