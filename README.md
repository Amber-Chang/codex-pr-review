# Codex PR Review

一個通用的 Codex plugin，把 GitHub PR 變成可重複的、以證據為基礎的 review 流程。
review 知識不存在機器本地記憶，而是由**消費端專案自己提供**（讀專案 repo 內的檔案），
讓同一套引擎可以服務任何專案。

## 這個 plugin 做什麼

1. 載入消費端專案自供的 review 知識（SPEC / PRD / 開發守則 / module 文件等）
2. 透過 `gh` 讀取一個 GitHub PR 與它的變更檔案
3. 組出一份 review packet，讓 Codex 可以做有根據的審查
4. 需要時，把已確認的 review 意見回貼到 PR

腳本本身**不會**自動 approve 或自動 merge 任何東西。

## 結構

```
.codex-plugin/plugin.json          # plugin manifest
.codex-plugin/marketplace.json     # marketplace 條目
skills/pr-review-agent/SKILL.md     # review skill（通用版）
config.cjs                          # 通用 config 載入器（消費端自供 + 安全預設）
prepare-pr-review.cjs               # 產生 review packet
post-pr-review-comments.cjs         # 回貼 review 意見
lib/github.cjs                      # gh / git 互動
lib/knowledge.cjs                   # 知識載入 + 比對
lib/review-packet.cjs               # 組 review packet
review-config.example.json          # 通用 config 範例
error-patterns.example.json         # 空的 error-patterns 範例
lib/*.test.cjs  config.test.cjs     # 測試（node --test）
```

## 消費端專案如何提供自己的 config

引擎不寫死任何專案路徑。每個使用此 plugin 的專案，在自己的 repo root 放一個
約定檔案：

```
<repo-root>/.codex/review-config.json
```

格式（schema）：

```json
{
  "knowledgeSources": [
    { "id": "review-checklist", "title": "Review Checklist", "path": "docs/review-checklist.md", "kind": "review-checklist" }
  ],
  "moduleDocHints": [
    { "prefix": "src/auth/", "doc": "docs/modules/auth.md" }
  ],
  "errorPatternsPath": ".codex/error-patterns.json"
}
```

欄位說明：

- `knowledgeSources`：要載入的知識檔（路徑**相對於 repo root**）。`kind` 是自由標籤，
  方便你自己分類。
- `moduleDocHints`：當 PR 改到 `prefix` 開頭的檔案時，建議一起讀 `doc` 這份 module 文件。
- `errorPatternsPath`：選填。指向專案自己的 error-pattern 資料檔（JSON，格式為 `{ "patterns": [] }`）。

可直接複製 `review-config.example.json` 當起點（範例值為通用佔位路徑，請改成你專案的真實路徑）。

### 找不到 config 時的行為（安全預設）

如果消費端專案**沒有** `.codex/review-config.json`（或檔案內容不是合法 JSON），
plugin 不會 crash，而是退回**安全預設**：

- `knowledgeSources` = 空
- `moduleDocHints` = 空
- 無 error patterns

此時 review 仍可進行，只是純粹基於 PR diff，沒有額外的專案知識。

### 關於 error-patterns

`error-patterns` 被視為**專案資料**，不是 plugin 內建內容。本 repo 只附一份空的
`error-patterns.example.json`。若你要用，請在自己專案內維護一份 patterns 檔，
並在 `review-config.json` 的 `errorPatternsPath` 指過去。

## 一鍵安裝（Claude Code）

在 Claude Code 內執行：

```
/plugin marketplace add Amber-Chang/codex-pr-review
/plugin install codex-pr-review@codex-pr-review
```

> 這是 private repo，需先在本機 `gh auth login`（背景自動更新才需另外設 `GITHUB_TOKEN`）。

## 指令用法（手動 / 非 Claude Code 環境）

下列 `<plugin-dir>` 指「含 `plugin.json` 的 plugin 安裝目錄」。請在**你要 review 的那個 repo 內**執行，
腳本會自動偵測 repo root 與該專案的 review config。

從 PR URL 或編號產生 review packet：

```bash
node <plugin-dir>/prepare-pr-review.cjs <pr-url-or-number> --write /tmp/pr-packet.json
```

把 JSON 檔裡的 review 意見回貼到 PR：

```bash
node <plugin-dir>/post-pr-review-comments.cjs <pr-url-or-number> --input /tmp/pr-comments.json
```

兩個腳本都支援 `--config <path>` 覆寫 config 位置（預設為 `<repo-root>/.codex/review-config.json`）。

## Comment JSON 格式

錨定到單一 diff 行的 line comment：

```json
[
  {
    "path": "src/auth/login.go",
    "line": 42,
    "body": "Major: 這條 retry 路徑仍在 application 端 busy-wait，與專案偏好的 DB-side blocking 模式衝突。"
  }
]
```

無法錨定到單行的後續追問（會匯整成一則一般 PR comment）：

```json
[
  {
    "body": "Open question: 這次只看到 backend 的契約改動，請確認 frontend 產生的型別是否也需要一起重新產生。"
  }
]
```

## 測試

從本 repo 根目錄執行：

```bash
node --test
```

涵蓋 `lib/github.test.cjs`、`lib/knowledge.test.cjs`、`config.test.cjs`
（含「找不到 config → 安全預設」與「config 損毀 → 安全預設」的行為）。

## 注意事項

- 需要 `gh auth` 對目標 repo 有效；無效時腳本會直接報錯，請先 `gh auth login -h github.com`。
- 跨 session 的知識存在消費端 repo 的檔案裡，而非機器本地記憶。

## 搭配 Codex 當「第二模型」獨立審查（選用）

這個 harness 由「**當下執行它的 agent**」來審查——裝在 Claude Code 就是 Claude 審、裝在 Codex 就是 Codex 審。若你想讓 **Codex**（不同模型家族）來審、達到「寫的人 ≠ 驗的人」的獨立性，有兩條路：

### A. 直接在 Codex 裡跑（最簡單可靠）

1. Codex CLI 裝好並 `codex login`。
2. 在 Codex 安裝本套件：`codex plugin marketplace add Amber-Chang/codex-pr-review`，並**完成安裝/reload，確認 `pr-review-agent` 已出現在 `~/.codex/skills/`**。
   > ⚠️ 只 `marketplace add` 不夠——skill 會停在 `~/.codex/.tmp/marketplaces/` 暫存區，沒同步進 `~/.codex/skills/` 的話 Codex 看不到。
3. 在 Codex session 貼 PR URL 或叫它用 `pr-review-agent` 審。

### B. 人在 Claude Code，把審查委派給 Codex（已實測可行）

搭配官方 [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc)（Apache-2.0）的 `/codex:rescue` 把任務交給本機 Codex：

1. Codex CLI 裝好並 `codex login`。
2. 在 **Claude Code** 裝 `openai/codex-plugin-cc`（提供 `/codex:rescue`）。
3. 在 **Codex** 完整安裝本套件（同 A 第 2 步，務必確認 skill 已進 `~/.codex/skills/`）。
4. 在 Claude Code 執行，例如：`/codex:rescue 用 pr-review-agent 審這個 repo 的 PR #5`。

> 已驗證（2026-06-30）：`/codex:rescue` 透過 Codex app-server 開一個標準 Codex thread，會載入 `~/.codex/skills/` 的 skill，因此能調用本套件的 `pr-review-agent`。前提是 skill 確實同步進 `~/.codex/skills/`。

> 與官方 `/codex:review` 的差異：`codex-plugin-cc` 自帶的 `/codex:review` 審「本地未提交改動」；本套件專做「針對某條 **GitHub PR**、用專案自帶的 `.codex/review-config.json` 規則審、並把確認的意見**貼回 PR**」。

## 致謝 / 出處

本工具的**概念**啟發自 Kelly Tsai 的影片〈矽谷最近瘋談的新詞，到底是什麼？AI 下一個高薪職缺是它？〉（<https://www.youtube.com/watch?v=T_GuZBHJ2mc>）。實作為作者參考概念後與 AI 協作自行撰寫，未複製影片或其附屬程式碼。

## License

MIT — 見 [`LICENSE`](LICENSE)。
