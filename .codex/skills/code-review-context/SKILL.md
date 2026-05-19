---
name: code-review-context
description: Provider prompt and context size guidance
---

Codenuke builds bounded feature context and strict provider prompts before sending
work to coding agents.

1. No unbounded prompt input - every injected file list, evidence block, report,
   transcript excerpt, and feature context item must have a hard cap.
2. Highlight any new individual prompt fragment that can cross 10K characters as
   P0 unless the code enforces truncation or summarization before provider use.
3. Preserve the separation between review, fix planning, and revalidation
   prompts. Do not let fix-oriented write permissions leak into review paths.
4. Provider output must remain strict JSON that is parsed through the existing
   schemas. Do not add permissive fallback parsing without tests and a clear
   compatibility reason.
5. Mapper context should explain why files belong to a feature. Avoid dumping
   large unrelated directories into a feature slice just because they are nearby.
6. Secret-bearing and generated files must stay out of provider context unless a
   user explicitly selected them and the command path already allows it.
