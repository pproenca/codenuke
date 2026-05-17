# codenuke Website

Static single-page site for the published `codenuke` CLI.

Files:

- `index.html`: self-contained page
- `favicon.svg`: browser icon
- `social-card.svg`: link preview card
- `social-card.png`: raster link preview card for Open Graph/Twitter

Preview:

```bash
cd website
python3 -m http.server 8000
```

Keep copy aligned with the implemented CLI:

- package: `codenuke` on npm
- provider: Codex, OpenCode, ACPX, Grok, plus test mocks
- review: feature review with `--jobs`
- fix: `codenuke fix --finding <id>`
- no auto-commit, PR creation, or landing yet
- no direct OpenAI provider yet
