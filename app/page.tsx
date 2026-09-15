"use client";

import { useRef, useState } from "react";
import Markdown from "react-markdown";

interface StoryMeta {
  fullName: string;
  totalCommits: number;
  sampledCommits: number;
  sampled: boolean;
  createdAt: string;
  stars: number;
}

const EXAMPLES = [
  "deviljoker1911-beep/ShipByThursday_via_claude",
  "sveltejs/svelte",
  "ziglang/zig",
  "tailwindlabs/tailwindcss",
];

export default function Home() {
  const [repo, setRepo] = useState("");
  const [story, setStory] = useState("");
  const [meta, setMeta] = useState<StoryMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  async function run(target: string) {
    const value = target.trim();
    if (!value || busy) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    setStory("");
    setMeta(null);

    try {
      const res = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: value }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? `Request failed (${res.status}).`);
        return;
      }
      if (!res.body) {
        setError("The server sent an empty response.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let headerParsed = false;

      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });

        // The first line is a JSON header; everything after it is story text.
        if (!headerParsed) {
          const newline = buffer.indexOf("\n");
          if (newline === -1) continue;
          try {
            setMeta(JSON.parse(buffer.slice(0, newline)) as StoryMeta);
          } catch {
            // Non-fatal: we just don't show the stats bar.
          }
          buffer = buffer.slice(newline + 1);
          headerParsed = true;
        }

        setStory(buffer);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const year = meta ? new Date(meta.createdAt).getFullYear() : null;

  return (
    <div className="relative z-10 mx-auto max-w-3xl px-5 pb-32 pt-10 sm:px-8 sm:pt-16">
      <header className="mb-16 flex items-center justify-between sm:mb-24">
        <span className="text-sm font-semibold tracking-tight text-[#f2ece5]">
          Shipped
        </span>
        <a
          href="https://github.com/deviljoker1911-beep/ShipByThursday_via_claude"
          className="text-xs text-(--color-muted) underline-offset-4 transition-colors hover:text-(--color-ember) hover:underline"
        >
          Built in 72 hours with Claude
        </a>
      </header>

      <h1 className="max-w-xl text-4xl leading-[1.1] font-semibold tracking-tight text-balance text-[#f7f2ec] sm:text-5xl">
        Every repo is a story.
        <br />
        <span className="text-(--color-muted)">Almost nobody reads it.</span>
      </h1>

      <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-(--color-muted)">
        A commit log is the most honest record a project has — every decision,
        reversal and long quiet stretch, timestamped. Paste a public repository
        and get the story that's been sitting in it the whole time.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(repo);
        }}
        className="mt-10"
      >
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="github.com/owner/repo"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            aria-label="GitHub repository URL"
            className="min-w-0 flex-1 rounded-lg border border-(--color-edge) bg-(--color-surface) px-4 py-3 text-[15px] text-[#f2ece5] transition-colors outline-none placeholder:text-[#5f574f] focus:border-(--color-ember)"
          />
          <button
            type="submit"
            disabled={busy || !repo.trim()}
            className="shrink-0 rounded-lg bg-(--color-ember) px-6 py-3 text-[15px] font-medium text-[#1a0d03] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Reading…" : "Read it"}
          </button>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-[#5f574f]">
        <span>Try</span>
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            disabled={busy}
            onClick={() => {
              setRepo(example);
              void run(example);
            }}
            className="rounded-md border border-(--color-edge) px-2 py-1 font-mono text-[11px] text-(--color-muted) transition-colors hover:border-(--color-ember) hover:text-(--color-ember) disabled:cursor-not-allowed disabled:opacity-40"
          >
            {example.split("/")[1]}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-10 rounded-lg border border-[#5c2e22] bg-[#1d110c] px-4 py-3 text-sm text-[#e8a488]">
          {error}
        </p>
      )}

      {meta && (
        <dl className="mt-14 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-(--color-edge) pt-6 sm:grid-cols-4">
          {[
            ["Repository", meta.fullName.split("/")[1]],
            ["Commits", meta.totalCommits.toLocaleString()],
            ["Since", year ? String(year) : "—"],
            ["Read", meta.sampled ? `${meta.sampledCommits} sampled` : "all of them"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-[10px] font-medium tracking-[0.14em] text-[#5f574f] uppercase">
                {label}
              </dt>
              <dd className="mt-1.5 truncate text-sm text-[#f2ece5]">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {busy && !story && (
        <p className="mt-10 text-sm text-(--color-muted)">
          Reading the history…
        </p>
      )}

      {story && (
        <article className={`story mt-10 ${busy ? "story-streaming" : ""}`}>
          <Markdown>{story}</Markdown>
        </article>
      )}

      <footer className="mt-28 border-t border-(--color-edge) pt-6 text-xs leading-relaxed text-[#5f574f]">
        Built with Claude between Tuesday and Thursday, in the open. The commits
        are the receipts —{" "}
        <a
          href="https://github.com/deviljoker1911-beep/ShipByThursday_via_claude"
          className="underline underline-offset-4 transition-colors hover:text-(--color-ember)"
        >
          read this repo&rsquo;s own story
        </a>
        .
      </footer>
    </div>
  );
}
