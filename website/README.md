# clawnuke Website

Static single-page site for the early `clawnuke` CLI.

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

- provider: local Codex CLI, plus test mocks
- review: sequential feature review
- fix: `clawnuke fix --finding <id>`
- no auto-commit, PR creation, or landing yet
- no direct OpenAI provider yet
