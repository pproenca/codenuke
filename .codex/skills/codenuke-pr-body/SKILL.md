---
name: codenuke-pr-body
description: Update the title and body of one or more codenuke pull requests.
---

## Determining the PR(s)

When this skill is invoked, the PR(s) to update may be specified explicitly, but
in the common case, infer the PR from the branch or commit the user is currently
working on. Use a combination of `git branch` and:

```shell
gh pr view <branch> --repo pproenca/codenuke --json number --jq '.number'
```

## PR Body Contents

When invoked, use `gh` to edit the pull request body and title to reflect the
contents of the specified PR. Check the existing pull request body first and
preserve important information. Never remove an image, recording, checklist, or
manual reproduction note unless the user explicitly asks.

It is critically important to explain _why_ the change is being made. If the
current conversation has discussed the motivation, capture it in the pull request
body.

The body should also explain _what_ changed, but this should appear after the
_why_.

Limit discussion to the _net change_ of the commit or stack. Avoid documenting
approaches that were tried and later undone unless that history is directly
relevant to reviewers.

Avoid references to absolute paths on the local disk. When talking about a path
inside the repository, use the repo-relative path.

It is generally helpful to discuss how the change was verified. Do not list
purely automatic formatting as the main test plan. Do mention focused tests,
evals, smoke checks, or CLI commands that intentionally validate the behavior.

For codenuke, call out these areas when relevant:

- mapper behavior and feature IDs
- provider command/schema contracts
- `.codenuke/` state compatibility
- CLI command/flag/output behavior
- docs or npm package install behavior
- safety guarantees around review vs fix

Use Markdown to format the pull request professionally. Ensure code things appear
in single backticks when referenced inline. Fenced code blocks are useful when
referencing code or showing a shell transcript. Use GitHub permalinks when citing
existing code that is relevant to the change.

Reference relevant issues or pull requests, but do not reference the pull
request in its own body.

If user-facing documentation should be updated in `README.md`, `docs/`, or
`website/`, note that in a separate section near the end of the pull request.
Omit this section if no documentation update is needed.

## Working with Stacks

Sometimes a pull request is composed of a stack of commits that build on one
another. In these cases, the PR body should reflect the _net_ change introduced
by the stack as a whole, rather than the individual commits that make up the
stack.

Similarly, if the PR base is another feature branch rather than `main`, discuss
only the net change between that base and the PR head.
