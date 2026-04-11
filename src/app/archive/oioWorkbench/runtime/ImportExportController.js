import {
  buildImportPairs,
  importOrphanNote,
  isImportAudioFile,
  isImportJsonFile,
  validateImportPayload,
} from "./runtimeUtils.js";
import { EXPORT_SCHEMA_VERSION } from "./constants.js";

export class ImportExportController {
  constructor({
    setStatus,
    saveImportedSessionToHistory,
    renderHistoryList,
    showImportSuccessDialog,
    showImportReportDialog,
  }) {
    this.setStatus = setStatus;
    this.saveImportedSessionToHistory = saveImportedSessionToHistory;
    this.renderHistoryList = renderHistoryList;
    this.showImportSuccessDialog = showImportSuccessDialog;
    this.showImportReportDialog = showImportReportDialog;
  }

  /**
   * @param {FileList | File[]} source
   */
  async processImportedFiles(source) {
    const files = source && typeof source.length === "number" ? [...source] : [];
    if (files.length === 0) return;
    const selectedJson = files.filter(isImportJsonFile).length;
    const selectedAudio = files.filter(isImportAudioFile).length;
    const selectedOther = Math.max(0, files.length - selectedJson - selectedAudio);
    const selectionSummary = `已选 ${files.length} 个文件（JSON ${selectedJson}，音频 ${selectedAudio}${
      selectedOther ? `，其他 ${selectedOther}` : ""
    }）。`;

    const built = buildImportPairs(files);
    if ("error" in built) {
      this.setStatus(built.error);
      this.showImportReportDialog("导入失败", `${selectionSummary}\n${built.error}`);
      return;
    }

    const { pairs, unmatchedJson, unmatchedAudio } = built;
    const orphan = importOrphanNote(unmatchedJson, unmatchedAudio);

    if (pairs.length === 0) {
      const msg = `未找到可配对的 JSON 与音频。${orphan}`.trim();
      this.setStatus(msg);
      this.showImportReportDialog("未导入成功", `${selectionSummary}\n${msg}`);
      return;
    }

    if (pairs.length === 1) {
      const { stem, jsonFile, audioFile } = pairs[0];
      this.setStatus("正在导入…");
      try {
        const text = await jsonFile.text();
        const data = JSON.parse(text);
        const err = validateImportPayload(data);
        if (err) {
          this.setStatus(err);
          this.showImportReportDialog("导入失败", `${selectionSummary}\n${err}`);
          return;
        }

        const saved = await this.saveImportedSessionToHistory(data, audioFile, stem);
        if (!saved.ok) {
          this.setStatus(saved.error);
          this.showImportReportDialog("导入失败", `${selectionSummary}\n${saved.error}`);
          return;
        }

        const keyFromName = this.localDateKeyFromExportBasename(stem);
        const dateLine = keyFromName ? `日历归入：${keyFromName}` : "日历归入：导入当日";

        const cueN = Array.isArray(data.cues) ? data.cues.length : 0;
        const ver = data.schemaVersion || EXPORT_SCHEMA_VERSION;
        const dialogLines = [
          selectionSummary,
          `已保存到「我的音频」。`,
          `主文件名：${stem}`,
          `共 ${cueN} 句 · ${ver}`,
          dateLine,
          `在列表中点「载入」可进入练习与播放。`,
        ];
        if (orphan) dialogLines.push(orphan.trim());
        this.showImportSuccessDialog(dialogLines.join("\n"));
        this.setStatus("");
        await this.renderHistoryList();
      } catch (e) {
        console.error(e);
        const msg =
          e instanceof SyntaxError
            ? "JSON 无法解析，请确认文件为 UTF-8 且内容完整。"
            : `导入失败：${e instanceof Error ? e.message : String(e)}`;
        this.setStatus(msg);
        this.showImportReportDialog("导入失败", `${selectionSummary}\n${msg}`);
      }
      return;
    }

    this.setStatus(`正在写入 ${pairs.length} 个练习包…`);
    let ok = 0;
    /** @type {string[]} */
    const fail = [];
    for (const p of pairs) {
      try {
        const text = await p.jsonFile.text();
        const data = JSON.parse(text);
        const r = await this.saveImportedSessionToHistory(data, p.audioFile, p.stem);
        if (r.ok) ok += 1;
        else fail.push(`${p.stem}: ${r.error}`);
      } catch {
        fail.push(`${p.stem}: 读取或解析失败`);
      }
    }
    const failPart = fail.length ? `失败 ${fail.length} 个：${fail.join("；")}` : "";
    this.setStatus(failPart || "");
    if (ok > 0) {
      const batchMsg = [selectionSummary, `成功导入 ${ok} 个练习包。`];
      if (fail.length) batchMsg.push(`另有 ${fail.length} 个失败，详情见页面底部状态行。`);
      if (orphan) batchMsg.push(orphan.trim());
      this.showImportSuccessDialog(batchMsg.join("\n"));
    } else {
      const msg = `批量导入未成功。${failPart} ${orphan}`.trim();
      this.setStatus(msg);
      this.showImportReportDialog("导入失败", `${selectionSummary}\n${msg}`);
    }
    await this.renderHistoryList();
  }

  localDateKeyFromExportBasename(basename) {
    const s = String(basename ?? "").trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{3})$/);
    if (!m) m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})-(\d{3})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    const mm = String(mo).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }

  wirePracticePackImport() {
    const btn = document.getElementById("history-import-btn");
    const input = document.getElementById("import-files-input");
    const ua = navigator.userAgent || "";
    const isMobileClient =
      /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    /** @type {File | null} */
    let mobilePendingJsonFile = null;

    const resetInputAcceptForDefault = () => {
      input.removeAttribute("accept");
      input.multiple = true;
    };

    if (input) {
      input.addEventListener("change", () => {
        const list = input.files;
        input.value = "";
        if (!list?.length) return;

        if (!isMobileClient) {
          void this.processImportedFiles(list);
          return;
        }

        const first = list[0];
        if (!mobilePendingJsonFile) {
          if (!isImportJsonFile(first)) {
            this.showImportReportDialog(
              "导入失败",
              "移动端请先选择 1 个 JSON 文件（第一步），然后再选择同名音频（第二步）。",
            );
            this.setStatus("移动端导入：请先选 JSON，再次点「导入文件」选同名音频。");
            return;
          }
          mobilePendingJsonFile = first;
          this.setStatus(`已选择 JSON：${first.name}。请再次点「导入文件」，选择同名音频。`);
          this.showImportReportDialog(
            "继续导入（第 1/2 步）",
            `已选择 JSON：${first.name}\n请再次点「导入文件」，在第二步选择同名音频文件。`,
          );
          return;
        }

        if (!isImportAudioFile(first)) {
          this.showImportReportDialog(
            "导入失败",
            `第二步需要选择音频文件（mp3/m4a/wav...）。\n当前选择：${first.name}`,
          );
          this.setStatus("第二步请选择音频文件。");
          return;
        }

        const pair = [mobilePendingJsonFile, first];
        mobilePendingJsonFile = null;
        resetInputAcceptForDefault();
        void this.processImportedFiles(pair);
      });
    }

    if (!btn || !input) return;

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      if (isMobileClient) {
        if (!mobilePendingJsonFile) {
          input.multiple = false;
          input.setAttribute("accept", ".json,application/json");
          this.setStatus("移动端导入（第 1/2 步）：请选择 1 个 JSON 文件。");
        } else {
          input.multiple = false;
          input.setAttribute("accept", ".wav,.mp3,.webm,.ogg,.m4a,.aac,.flac,audio/*");
          this.setStatus(`移动端导入（第 2/2 步）：请为 ${mobilePendingJsonFile.name} 选择同名音频。`);
        }
        try {
          input.click();
        } catch (e) {
          console.error(e);
          this.setStatus("无法打开文件选择框，请换浏览器重试。");
        }
        return;
      }

      resetInputAcceptForDefault();
      const canPicker =
        typeof window.showOpenFilePicker === "function" && window.isSecureContext === true;

      if (canPicker) {
        void (async () => {
          this.setStatus("正在打开文件选择器…");
          try {
            const handles = await window.showOpenFilePicker({
              multiple: true,
              types: [
                {
                  description: "练习包（JSON + 音频）",
                  accept: {
                    "application/json": [".json"],
                    "audio/wav": [".wav"],
                    "audio/mpeg": [".mp3"],
                    "audio/webm": [".webm"],
                    "audio/ogg": [".ogg"],
                    "audio/mp4": [".m4a"],
                  },
                },
              ],
            });
            const files = await Promise.all(handles.map((h) => h.getFile()));
            if (files.length) await this.processImportedFiles(files);
            else this.setStatus("未选择文件。");
          } catch (err) {
            const name = err && /** @type {{ name?: string }} */ (err).name;
            if (name === "AbortError") {
              this.setStatus("已取消选择。");
              return;
            }
            console.warn("[OIO Lab] showOpenFilePicker 不可用，回退到传统选择框：", err);
            this.setStatus("请在本页再次选择文件。");
            try {
              input.click();
            } catch (e2) {
              console.error(e2);
              this.setStatus("无法打开文件选择框，请换浏览器或检查页面权限。");
            }
          }
        })();
        return;
      }

      this.setStatus("请选择：每个包一对主文件名相同的 .json 与音频（可多选）。");
      try {
        input.click();
      } catch (e) {
        console.error(e);
        this.setStatus("无法打开文件选择框，请换浏览器重试。");
      }
    });
  }
}
