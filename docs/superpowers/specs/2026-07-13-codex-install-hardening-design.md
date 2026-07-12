<!-- [AI-ASSISTED] by PM Amber, 2026-07-13 -->
<!-- 功能：定義 Codex 安裝驗證、PR 狀態契約與 builder-pm PR #7 live review。 -->

# Codex 安裝強化與 Live PR Review 設計

> 狀態：PM 已批准方向，等待書面規格確認
> 日期：2026-07-13

## 1. 目標

讓 `codex-pr-review` 在 Codex 環境有可驗證、可維護的安裝與啟用流程，並用 `Amber-Chang/builder-pm#7` 完成真實 prepare → review → post 流程。

完成後必須能回答：plugin package 是否完整、Codex 是否真的看得到 `pr-review-agent`，以及真實 PR 是否能載入專案知識並回貼高信心 findings。

## 2. 已確認現況

- Repository 已是 public，README 的 private repo 說明過期。
- `.claude-plugin/` 與 `.codex-plugin/` manifests 都已存在。
- `codex-cli 0.125.0` 支援 `codex plugin marketplace add`，但沒有通用的 `codex plugin install`。
- Marketplace add 不代表 skill 已進入 Codex 可用 skills。
- 現有 skill 使用舊狀態 `Overall: PASS / NEEDS_CHANGES / NEEDS_REDESIGN`。
- prepare / post scripts 與 unit tests 已存在，不重寫 review engine。

## 3. 設計原則

### 3.1 不寫入 Codex 私有目錄

不製作自行 copy / symlink 到 `~/.codex/skills/` 或暫存 marketplace 路徑的 installer。採官方流程：

1. `codex plugin marketplace add Amber-Chang/codex-pr-review`
2. 依當前 Codex App / CLI 能力完成 activation 或 reload
3. 用本 repo verifier 驗證 package 與 active skill

Verifier 負責判定，不假裝執行不存在的官方命令。

### 3.2 Fail closed

`gh auth`、PR、plugin package、active skill 或必要 knowledge 任一缺失時，只能輸出 `PR REVIEW BLOCKED`。不得用一般 diff review 取代正式 gate 後宣稱 `PR PASS`。

### 3.3 自動回貼品質閘

PM 已授權本次 `builder-pm#7` 可直接回貼，不需逐筆確認，但 finding 必須：

- 高信心且由 diff / 專案規則支持
- 指出具體行為風險
- Line comment 有有效 `path + line`
- 無法定位單行但仍重要時才用 general comment
- 不貼純風格、推測性或低信心意見

若沒有合格 finding，不為了證明流程而製造留言；以可驗證的 `PR PASS` 結果收尾。

## 4. 變更範圍

### 4.1 安裝驗證器

新增：

```text
scripts/verify-codex-install.cjs
scripts/verify-codex-install.test.cjs
```

Package check：

- 兩份 Codex manifest 可解析且版本一致
- Manifest 的 skills 路徑存在
- `skills/pr-review-agent/SKILL.md` frontmatter 合法
- prepare、post 與必要 `lib/*.cjs` 存在

Active install check：

- Codex CLI 可執行並回報版本
- CLI 支援 `plugin marketplace add`
- 不假設存在 `plugin install`
- 指定 active skill 可讀，且版本與 manifest 一致

輸出狀態：

- `READY`：package 與 active skill 都可用
- `PACKAGE_ONLY`：package 完整，但 active skill 尚未驗證；不得放行 PR
- `BLOCKED`：必要檔案、CLI、skill 或版本不一致

CLI：

```bash
node scripts/verify-codex-install.cjs --plugin-dir .
node scripts/verify-codex-install.cjs --plugin-dir . --active-skill ~/.codex/skills/pr-review-agent/SKILL.md
node scripts/verify-codex-install.cjs --plugin-dir . --json
```

不猜測唯一全域 Codex 路徑；active skill 路徑由官方 activation 結果或使用者明確傳入。

### 4.2 PR review skill 契約

修改 `skills/pr-review-agent/SKILL.md`：

- 正式狀態改為 `PR PASS / PR FAIL / PR REVIEW BLOCKED`
- 先驗證 plugin、`gh auth`、PR 與 knowledge 載入
- `PR PASS` 必須有 packet 與 review 證據
- 缺條件時禁止輸出舊裸 `PASS`
- 保留「只有明確授權才 post」；PR #7 授權不硬編進通用 skill

### 4.3 README

- 修正 public/private 過期敘述
- 分開 Claude Code 與 Codex activation
- Codex 不寫不存在的 `plugin install`
- 補 verifier 指令與三種狀態
- 區分 marketplace registered、plugin active、skill verified
- 補 PR 狀態與自動回貼條件

### 4.4 契約測試

驗證：

- Manifest 與 skill 版本一致
- Skill 使用新 PR 狀態，無舊 Overall enum
- README 不再宣稱 private，也不含 Codex `plugin install`
- Verifier 的 READY / PACKAGE_ONLY / BLOCKED 與 JSON output
- 缺 manifest、缺 script、版本不一致、CLI capability 不足會 fail closed
- 既有 `node --test` 全部通過

## 5. Live Review：builder-pm PR #7

### 5.1 前置條件

- `gh auth status` 有效，PR #7 open
- PR branch 含 `.codex/review-config.json` 且 knowledge sources 可讀
- Package verifier 至少 `PACKAGE_ONLY`
- Active verifier 必須 `READY`；若 activation 受外部產品限制，必須明記，不能把 direct-script smoke test 說成 plugin discovery 已驗證

### 5.2 流程

1. 從 builder-pm repo 執行 `prepare-pr-review.cjs 7 --write /tmp/builder-pm-pr-7-packet.json`
2. 驗證 packet 含 PR metadata、diff、changed files 與 knowledge 結果
3. 依 skill 契約產生 `PR PASS / PR FAIL / PR REVIEW BLOCKED`
4. 高信心 findings 轉 comments JSON
5. 執行 `post-pr-review-comments.cjs 7 --input /tmp/builder-pm-pr-7-comments.json`
6. 讀回 PR comments，確認內容與數量

### 5.3 防重複

- Post 前讀現有 PR comments
- 同一 `path + line + body` 不重複貼
- General comment 使用穩定前綴 `[codex-pr-review]`
- Retry 不得產生相同 comment

若現有 post script 沒有防重複能力，先以測試補上再跑 live posting。

## 6. 錯誤處理

| 情境 | 行為 |
|---|---|
| Package 不完整 | `BLOCKED`，列缺檔 |
| Marketplace 已加入但 skill 未 active | `PACKAGE_ONLY`，提示 activation / reload / verify |
| CLI 沒有 `plugin install` | 正常相容狀態，不輸出不存在指令 |
| `gh auth` 失效 | `PR REVIEW BLOCKED`，不 prepare / post |
| 必要 knowledge 缺失 | `PR REVIEW BLOCKED`，不降級完整 PASS |
| 沒有高信心 findings | `PR PASS`，不製造 comment |
| Post 部分成功 | 停止盲目 retry，先讀回遠端 comments 去重 |
| GitHub API 暫時失敗 | 保留 comments JSON，讀回狀態後才決定重試 |

## 7. 驗收標準

1. Verifier 三種狀態正反測試通過。
2. README 與實際 Codex CLI 能力一致。
3. Skill 使用新 PR 狀態，沒有舊 enum 漂移。
4. 既有與新增 tests 全數通過。
5. `builder-pm#7` packet 成功載入 knowledge 與 diff。
6. 高信心 findings 已回貼；無 findings 時有可驗證的 PR PASS 證據。
7. Retry 不會重複留言。
8. `codex-pr-review` 分支 push，建立 Ready for review PR。

## 8. 不在範圍

- 不 reverse engineer Codex App 私有安裝目錄。
- 不建立直接修改 `~/.codex` 的 custom installer。
- 不自動 approve 或 merge `builder-pm#7`。
- 不回貼低信心、純風格或無法證明的 finding。
- 不修改 builder-pm 程式；live review 找到問題只回貼該 PR。
