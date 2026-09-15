import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepoRef, GitHubError } from "./github.ts";

// Run with: npm test
//
// These cover parsing only — no network. The shapes below are all real things
// people paste: GitHub's copy-link button appends `?tab=readme-ov-file`, the
// clone box gives you a `.git` suffix, and half the time someone just types
// `owner/repo` from memory.

test("parses the URL shapes people actually paste", () => {
  const cases: [string, string][] = [
    ["https://github.com/sindresorhus/is-odd?tab=readme-ov-file", "sindresorhus/is-odd"],
    ["https://github.com/facebook/react#readme", "facebook/react"],
    ["https://github.com/vercel/next.js", "vercel/next.js"],
    ["https://github.com/vercel/next.js/tree/canary/packages", "vercel/next.js"],
    ["https://www.github.com/jquery/jquery/", "jquery/jquery"],
    ["git@github.com:sveltejs/svelte.git", "sveltejs/svelte"],
    ["github.com/ziglang/zig", "ziglang/zig"],
    ["tailwindlabs/tailwindcss", "tailwindlabs/tailwindcss"],
    ["  facebook/react  ", "facebook/react"],
  ];

  for (const [input, expected] of cases) {
    const { owner, repo } = parseRepoRef(input);
    assert.equal(`${owner}/${repo}`, expected, `parsing ${input}`);
  }
});

test("rejects input rather than guessing at it", () => {
  for (const bad of [
    "not a repo at all",
    "",
    "   ",
    "https://gitlab.com/foo/bar",
    "https://github.com/onlyowner",
  ]) {
    assert.throws(() => parseRepoRef(bad), GitHubError, `should reject ${JSON.stringify(bad)}`);
  }
});

test("a query string is not part of the repo name", () => {
  // Regression: `[^/\s]+` captured `is-odd?tab=readme-ov-file` as the repo,
  // which then 404s against the API.
  const { repo } = parseRepoRef("https://github.com/sindresorhus/is-odd?tab=readme-ov-file");
  assert.equal(repo, "is-odd");
});
