# P0-3/P0-4 运行时验收 · local-candidate

- Base: http://127.0.0.1:3215
- Expected SHA: 9bc4fbb7cdc999d5e61814d2bd22967859b964cd
- Verdict: **FAIL**
- Login: FAIL
- Health/SHA: PASS 9bc4fbb
- Pages: {"FAIL":16,"PASS":8,"BLOCKED":8}
- API: invite-lookup-invalid=PASS, plans-read=PASS, invite-write=BLOCKED, invite-lookup-invalid=PASS, plans-read=PASS, invite-write=BLOCKED
- CTA: home-primary-cta=FAIL, home-primary-cta=PASS

详细证据见 `result.json`、各 pass 的 `shots/` 与 `video/`。
