# Localization

AgentSpace supports English, Simplified Chinese, Japanese, Korean and Spanish. Each language must describe the same product, permissions and observable results. Sentence order, headings and explanations should read naturally in that language.

## Meaning that must stay fixed

- Human edits save directly. Agent changes are proposals that require a person's decision.
- Reading a proposal, processing it and reviewing knowledge are separate actions. Applying a proposal does not certify its content.
- A recovery draft is separate from a successful content save. Unsaved edits alone do not prove that a recovery draft was retained.
- A brief contains selected version references; copying saved context includes one item's saved body or selected body text. Neither action creates access or proves agent receipt.
- An active grant means access is enabled. It does not prove that an agent host is connected. Fixed-object access does not expand through links.
- Proposal permissions change only when explicitly saved. Editing content keeps the existing permissions.
- A proposal's base version stays fixed. Applying it requires the current saved version to match that base.
- Import results describe each item's actual state. Original files remain unchanged before, during and after an import.
- Reports of loaded results and scan limits must not imply a complete search or a complete historical snapshot.

## Shared vocabulary

Use these product terms consistently. Grammar may change with the sentence; a state label must remain distinguishable from an instruction.

| Concept                         | English                  | 简体中文       | 日本語             | 한국어           | Español                  |
| ------------------------------- | ------------------------ | -------------- | ------------------ | ---------------- | ------------------------ |
| Saved content                   | Saved                    | 已保存         | 保存済み           | 저장됨           | Guardado                 |
| Recovery draft                  | Recovery draft           | 恢复草稿       | 復旧用の下書き     | 복구용 초안      | Borrador de recuperación |
| Proposal                        | Proposal                 | 提案           | 提案・変更案       | 제안             | Propuesta                |
| Processed proposals             | Processed                | 已处理         | 処理済み           | 처리됨           | Procesadas               |
| No human knowledge review       | Never reviewed           | 尚未复核       | 未確認             | 검토 전          | Nunca revisado           |
| Human review of current version | Current version reviewed | 当前版本已复核 | 現在の版を確認済み | 현재 버전 검토됨 | Versión actual revisada  |
| Pinned reference                | Pinned version           | 固定版本       | 固定した版         | 고정 버전        | Versión fijada           |
| Reusable resource               | Asset                    | 资产           | アセット           | 자산             | Recurso                  |
| Evidence source                 | Source                   | 来源           | 出典               | 출처             | Fuente                   |

“Project material” means linked content, not people. “Original” must identify the current managed object or the external source file when both are possible. Explain an agent host as the application running the agent on first use; keep protocol identifiers unchanged.

## Voice by language

These are editorial choices for this product, not assumptions about every speaker's preferences.

- **English:** use short, active sentences. Name the action and result directly. Qualify “review” when a proposal decision and a knowledge review could be confused. Explain a condition before a consequence that could affect someone's work.
- **简体中文：**用“你”保持自然、直接的语气。用“选择、保存、复制、撤销”等具体动词，少用抽象名词堆叠。明确区分“资料”“项目”“条目”和“授权”；正文中先讲操作及结果，再补充必要限制。
- **日本語：**説明は「です・ます」調で統一します。操作名は「保存」「コピー」など簡潔にし、完了・進行中の状態を命令形にしません。出典、基準版、現在の版を区別し、長い修飾を短い文に分けます。
- **한국어:** 설명은 합니다체로, 직접 행동을 안내할 때는 하세요체로 씁니다. 자료·항목·자산을 구분하고 사람을 뜻하는 구성원으로 자료를 표현하지 않습니다. 버튼의 동작과 완료 상태를 구별하고 권한 취소 용어를 일관되게 씁니다.
- **Español:** use neutral international wording and consistent **tú** forms. Write instructions with direct verbs. Explain technical terms on first use; distinguish _versión_, the stored version of an item, from _revisión_, a person's review. Keep state labels distinct from completed actions.

Headings should express the reader's purpose. They need not mirror English word order or imagery. Keep the same prerequisites, outcomes, limits and next actions across languages.

## Text, values and formats

- Keep all dictionary keys and named placeholders identical. Preserve literal protocol names, command flags, paths in examples and machine-readable formats such as `YYYY-MM-DD`.
- Translate product copy only. Preserve authored titles, body text, field labels, agent reasons and imported content exactly; never save a translated display placeholder into content.
- Format displayed numbers and dates through the shared formatters. Calendar dates must keep their day; instants use an explicit time zone.
- The current language-only locale settings use the runtime's `Intl` conventions. Spanish copy is internationally neutral; that does not make one runtime's regional date or number format universal. There is no separate country-format selector.
- Keep limits exact: Unicode code points are not bytes or user-perceived characters. Do not shorten an error, conflict or recovery message until it loses a condition or next action.

## Review and verification

1. Check the code path and visible state before changing a claim. The English text can also be wrong.
2. Read the complete interaction in each language, including success, pending, partial failure, conflict and recovery.
3. Match documented control names to actual labels. Review the README, user guide and packaged start instructions together.
4. Run dictionary parity, interpolation and formatting tests, followed by source and documentation gates.
5. Verify real desktop layout in all five languages at supported sizes. Check full text, wrapping, focus and keyboard behavior; preserve authored text during language changes.

See the [dictionary contracts](../src/renderer/i18n/README.md) and [test commands and platform limits](TESTING.md). Automated checks establish contracts and layout behavior; fluent-speaker usability feedback remains valuable.

## References

- [Microsoft writing style: word choice](https://learn.microsoft.com/en-us/style-guide/word-choice/): familiar words and consistent terminology.
- [Microsoft localization style guides](https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides): language-specific guidance, including Simplified Chinese, Japanese, Korean and neutral Spanish.
- [SmartHR: UI text](https://smarthr.design/products/contents/ui-text/app-writing/) and [status labels](https://smarthr.design/products/contents/ui-text/statuslabel/): Japanese interface wording and the distinction between state and action.
- [FundéuRAE: abbreviations and acronyms](https://www.fundeu.es/recomendacion/siglas-y-acronimos-claves-de-redaccion/): explain unfamiliar abbreviations rather than assuming technical knowledge.
