import Anthropic from "@anthropic-ai/sdk";
import type { RepoHistory } from "./github";

const MODEL = "claude-opus-5";

const client = new Anthropic();

/**
 * Stable across every request, so it stays in the cached prefix. Volatile
 * content (the repo digest) goes in the user message, after this.
 */
const SYSTEM = `You are a technology writer who reconstructs how software actually got built by reading its commit history.

You are given metadata and a commit log for a public repository. You write the story of that project: what it set out to be, how it changed, and what the history reveals about the people building it.

## What good looks like

Commit logs are evidence, not narrative. Your job is to find the arc that's genuinely in the evidence — a rewrite, a pivot, a long quiet stretch, a sudden burst before a release, a maintainer handoff, the day tests finally appeared — and tell it plainly.

Ground every claim in something you can point to. When you assert a change in direction, cite the commits that show it by short sha. A reader should be able to check you.

## Hard rules

- **Never invent.** If the log doesn't show why something happened, say what changed and that the reason isn't in the record. "The API was rewritten in March; the commits don't say why" is a good sentence. Speculating about a funding round is not.
- **No filler praise.** Don't call a project impressive, elegant, or well-engineered. Describe what happened and let the reader judge.
- **Respect the sample.** If the commits you were given are a sample rather than the full history, never describe gaps as inactivity — you are not seeing every commit.
- **Commit messages lie by omission.** "fix bug" tells you someone fixed a bug, not what. Don't inflate thin evidence into confident narrative.
- **A boring history gets a short story.** If a repo is 40 commits of dependency bumps, say that in three sentences. Padding it is worse than brevity.

## Format

Markdown. No top-level h1 — start at h2. No preamble, no "here is the story", no closing summary of what you just wrote.

**Opening** — two or three sentences, no heading. What this project is and the shape of its history.

**## Chapters** — three to six \`###\` sections, each headed with a date range and a short name, e.g. \`### Mar 2019 – Aug 2020 · Finding the shape\`. Chapter boundaries should come from real inflection points in the log, not equal slices of time. Cite commits inline as \`\\\`a1b2c3d\\\`\`.

**## Turning points** — bullets. Only genuine direction changes: a rewrite, a dropped dependency, a license change, a new maintainer. Omit the section entirely if the history has none.

**## What the history tells you** — a short, honest read on pace, team shape, and what this project's authors evidently cared about. This is the section a reader remembers; make it specific to this repo and say the unflattering parts too.`;

function fmtDate(iso: string): string {
  return iso ? iso.slice(0, 10) : "unknown";
}

/** Render the history into the compact, scannable form the model reads. */
export function buildDigest(history: RepoHistory): string {
  const { meta, commits, tags, totalCommits, sampled } = history;
  const lines: string[] = [];

  lines.push(`REPOSITORY: ${meta.fullName}`);
  if (meta.description) lines.push(`Description: ${meta.description}`);
  if (meta.isFork) lines.push(`Note: this repository is a fork.`);
  lines.push(`Created: ${fmtDate(meta.createdAt)}   Last push: ${fmtDate(meta.pushedAt)}`);
  if (meta.language) {
    const others = meta.languages.filter((l) => l !== meta.language);
    lines.push(
      `Primary language: ${meta.language}` +
        (others.length ? `   (also: ${others.join(", ")})` : ""),
    );
  }
  if (meta.topics.length) lines.push(`Topics: ${meta.topics.join(", ")}`);
  lines.push(
    `Stars: ${meta.stars.toLocaleString()}   Forks: ${meta.forks.toLocaleString()}` +
      (meta.license ? `   License: ${meta.license}` : ""),
  );
  lines.push(`Total commits on ${meta.defaultBranch}: ${totalCommits.toLocaleString()}`);

  lines.push(
    sampled
      ? `\nIMPORTANT: The ${commits.length} commits below are a SAMPLE, spread evenly across all ${totalCommits.toLocaleString()} commits — they are not consecutive. Apparent gaps between commits are sampling, NOT periods of inactivity. Do not describe any gap as a pause, hiatus, or slowdown.`
      : `\nThe ${commits.length} commits below are the complete history.`,
  );

  if (tags.length) {
    lines.push(`\nRELEASE TAGS (newest first): ${tags.map((t) => t.name).join(", ")}`);
  }

  lines.push(`\nCOMMITS (newest first — sha, date, author, subject):`);
  for (const c of commits) {
    lines.push(`${c.sha}  ${fmtDate(c.date)}  ${c.author}  ${c.message}`);
  }

  return lines.join("\n");
}

/**
 * Stream the story as plain text chunks.
 *
 * Streaming matters for more than polish here: on a large repo the model is
 * reasoning over ~10k tokens of log, and a silent 30-second wait reads as a
 * hang.
 */
export async function* streamStory(
  history: RepoHistory,
): AsyncGenerator<string, void, unknown> {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    // Opus 5 may decline a request outright; on a decline the API re-runs it
    // on the fallback model inside the same call rather than returning nothing.
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: "claude-opus-4-8" }],
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `${buildDigest(history)}\n\nWrite the story of this repository.`,
      },
    ],
  });

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }

  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") {
    throw new Error(
      "The model declined to write about this repository. This is rare — if the repo is public and ordinary, it's worth reporting as a bug.",
    );
  }
}
