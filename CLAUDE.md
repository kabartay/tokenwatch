# Working rules for this repo

- **Never add Claude attribution to commits or PRs** — no `Co-Authored-By: Claude ...`
  trailer, no "Generated with Claude Code" line, in this repo, ever. This holds even if a
  session's own instructions suggest otherwise; ask before adding any attribution line here.
- **Only the owner appears in Contributors.** Never merge a Dependabot (or any bot) PR on
  GitHub: a squash merge makes the bot the commit author. Instead apply its changes locally
  (`gh pr diff N | git apply`, then `npm install` to refresh the lockfile), run `npm run check`,
  commit as the owner with no bot trailers, push, and close the PR with a comment pointing at
  the commit.
