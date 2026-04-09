export class HistoryExportController {
  constructor({
    dom,
    setStatus,
    listSessions,
    getSession,
    toLocalDateKeyFromSaved,
    rowMatchesHistoryExportFilter,
    nextExportBasename,
    audioBlobToExtension,
    downloadBlob,
  }) {
    this.dom = dom;
    this.setStatus = setStatus;
    this.listSessions = listSessions;
    this.getSession = getSession;
    this.toLocalDateKeyFromSaved = toLocalDateKeyFromSaved;
    this.rowMatchesHistoryExportFilter = rowMatchesHistoryExportFilter;
    this.nextExportBasename = nextExportBasename;
    this.audioBlobToExtension = audioBlobToExtension;
    this.downloadBlob = downloadBlob;

    this.rows = [];
    this.wired = false;
  }

  async downloadSingle(id) {
    const row = await this.getSession(id);
    if (!row?.payload || !row.audioBlob) {
      this.setStatus("记录不可用，无法下载。");
      return;
    }
    const base = row.basename || this.nextExportBasename();
    const jsonBlob = new Blob([JSON.stringify(row.payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const ext = this.audioBlobToExtension(row.audioBlob);
    this.downloadBlob(jsonBlob, `${base}.json`);
    this.downloadBlob(row.audioBlob, `${base}.${ext}`);
    this.setStatus(`已下载 ${base}.json 与 ${base}.${ext}`);
  }

  async buildZip(rows) {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    const names = new Set();
    let packed = 0;

    for (const row of rows) {
      if (!row?.payload || !row.audioBlob) continue;

      const stem =
        String(row.basename || row.id || "entry")
          .replace(/[/\\?*:|"<>]/g, "-")
          .slice(0, 120) || "entry";

      let uniq = stem;
      let i = 0;
      while (names.has(uniq)) {
        i += 1;
        uniq = `${stem}-${i}`;
      }
      names.add(uniq);

      zip.file(`${uniq}.json`, JSON.stringify(row.payload, null, 2));
      const ext = this.audioBlobToExtension(row.audioBlob);
      const ab = await row.audioBlob.arrayBuffer();
      zip.file(`${uniq}.${ext}`, ab);
      packed += 1;
    }

    if (packed === 0) return null;
    return {
      blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
      packed,
    };
  }

  syncSelectAllState() {
    const { selectAll, list } = this.dom;
    if (!selectAll || !list) return;
    const checks = [...list.querySelectorAll("[data-export-id]")];
    if (checks.length === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
      return;
    }
    const selected = checks.filter((el) => el.checked).length;
    selectAll.checked = selected === checks.length;
    selectAll.indeterminate = selected > 0 && selected < checks.length;
  }

  renderFilteredList() {
    const { list, count, from, to } = this.dom;
    if (!list || !count) return;

    const fromVal = from?.value ?? "";
    const toVal = to?.value ?? "";
    const rows = this.rows.filter((r) => this.rowMatchesHistoryExportFilter(r, fromVal, toVal));

    list.replaceChildren();
    for (const row of rows) {
      const label = document.createElement("label");
      label.className = "history-export-row";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.exportId = row.id;

      const text = document.createElement("span");
      text.className = "history-export-row-text";
      const day = this.toLocalDateKeyFromSaved(row.savedAt) || "日期未知";
      const base = row.basename || "（未命名）";
      text.textContent = `${day} · ${base}`;

      label.appendChild(cb);
      label.appendChild(text);
      list.appendChild(label);
    }

    if (rows.length) count.textContent = `当前列表 ${rows.length} 条`;
    else if (fromVal || toVal) count.textContent = "没有符合区间的记录";
    else count.textContent = "暂无记录";

    this.syncSelectAllState();
  }

  async openDialog() {
    try {
      this.rows = await this.listSessions();
    } catch (e) {
      console.error(e);
      this.setStatus("无法读取本地历史。");
      return;
    }

    const { from, to, selectAll, dialog } = this.dom;
    if (from) from.value = "";
    if (to) to.value = "";
    if (selectAll) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    }

    this.renderFilteredList();
    dialog?.showModal();
  }

  getSelectedRows() {
    const { list } = this.dom;
    const ids = new Set(
      [...(list?.querySelectorAll("[data-export-id]:checked") ?? [])].map((el) => el.dataset.exportId),
    );
    return this.rows.filter((r) => ids.has(r.id) && r.payload && r.audioBlob);
  }

  async exportSelected() {
    const selected = this.getSelectedRows();
    if (!selected.length) {
      this.setStatus("请至少勾选一条完整记录（含 JSON 与音频）。");
      return;
    }

    try {
      this.setStatus("正在打包 ZIP…");
      const packed = await this.buildZip(selected);
      if (!packed) {
        this.setStatus("没有可打包的完整记录。");
        return;
      }
      const name = `kokoro-history-selected-${new Date().toISOString().slice(0, 10)}.zip`;
      this.downloadBlob(packed.blob, name);
      this.setStatus(`已下载 ${name}（共 ${packed.packed} 条）。`);
      this.dom.dialog?.close();
    } catch (e) {
      console.error(e);
      this.setStatus("打包下载失败，请稍后再试。");
    }
  }

  wireEvents() {
    if (this.wired) return;
    this.wired = true;

    const { openBtn, cancel, applyRange, clearRange, from, to, selectAll, list, confirm } = this.dom;

    openBtn?.addEventListener("click", () => {
      this.openDialog();
    });

    cancel?.addEventListener("click", () => {
      this.dom.dialog?.close();
    });

    applyRange?.addEventListener("click", () => {
      this.renderFilteredList();
    });

    clearRange?.addEventListener("click", () => {
      if (from) from.value = "";
      if (to) to.value = "";
      this.renderFilteredList();
    });

    from?.addEventListener("change", () => {
      this.renderFilteredList();
    });

    to?.addEventListener("change", () => {
      this.renderFilteredList();
    });

    selectAll?.addEventListener("change", () => {
      const checked = selectAll.checked;
      list?.querySelectorAll("[data-export-id]").forEach((el) => {
        el.checked = checked;
      });
      this.syncSelectAllState();
    });

    list?.addEventListener("change", (evt) => {
      if (evt.target?.matches?.("[data-export-id]")) this.syncSelectAllState();
    });

    confirm?.addEventListener("click", async () => {
      await this.exportSelected();
    });
  }
}
