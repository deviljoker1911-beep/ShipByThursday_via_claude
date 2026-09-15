/**
 * GitHub history fetching.
 *
 * The interesting constraint here: a repo's story lives across its whole
 * history, but the API hands you the newest 100 commits first. Reading only
 * those gives you the last month of a ten-year project. So for anything large
 * we sample evenly across the full commit range instead — see sampleCommits.
 */

const API = "https://api.github.com";

export class GitHubError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RepoMeta {
  fullName: string;
  description: string | null;
  homepage: string | null;
  stars: number;
  forks: number;
  createdAt: string;
  pushedAt: string;
  language: string | null;
  languages: string[];
  topics: string[];
  license: string | null;
  isFork: boolean;
  defaultBranch: string;
}

export interface Commit {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export interface Tag {
  name: string;
  sha: string;
}

export interface RepoHistory {
  ref: RepoRef;
  meta: RepoMeta;
  commits: Commit[];
  tags: Tag[];
  totalCommits: number;
  sampled: boolean;
}

/**
 * Accepts anything a person might paste: a full URL, a `git@` remote, or the
 * bare `owner/repo` they typed from memory.
 */
export function parseRepoRef(input: string): RepoRef {
  const trimmed = input.trim().replace(/\.git$/, "").replace(/\/+$/, "");
  if (!trimmed) throw new GitHubError("Enter a GitHub repository.", 400);

  // Owner and repo are matched against GitHub's actual legal character sets
  // rather than "anything up to a slash". That matters: GitHub's own copy-link
  // button hands you `...?tab=readme-ov-file`, and a looser pattern captures
  // the query string as part of the repo name and then 404s.
  const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
  const REPO = "[A-Za-z0-9._-]+";

  const patterns = [
    new RegExp(`^https?://(?:www\\.)?github\\.com/(${OWNER})/(${REPO})`, "i"),
    new RegExp(`^git@github\\.com:(${OWNER})/(${REPO})$`, "i"),
    new RegExp(`^github\\.com/(${OWNER})/(${REPO})`, "i"),
    new RegExp(`^(${OWNER})/(${REPO})$`),
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return { owner: match[1], repo: match[2] };
  }

  throw new GitHubError(
    "That doesn't look like a GitHub repo. Try a URL like https://github.com/owner/repo.",
    400,
  );
}

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "shipped-by-thursday",
  };
  if (process.env.GITHUB_TOKEN) {
    h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return h;
}

async function gh(path: string): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    headers: headers(),
    cache: "no-store",
  });

  if (res.ok) return res;

  if (res.status === 404) {
    throw new GitHubError(
      "Repo not found. It may be private, renamed, or misspelled — Shipped only reads public repos.",
      404,
    );
  }

  // GitHub returns 403 for both rate limiting and blocked access; the
  // remaining-count header is what actually distinguishes them.
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      const mins = Math.max(1, Math.ceil((reset - Date.now()) / 60000));
      throw new GitHubError(
        process.env.GITHUB_TOKEN
          ? `GitHub rate limit reached. Resets in about ${mins} minute${mins === 1 ? "" : "s"}.`
          : "GitHub rate limit reached. Set GITHUB_TOKEN in your environment to raise the limit from 60/hour to 5,000/hour.",
        429,
      );
    }
    throw new GitHubError("GitHub refused the request.", 403);
  }

  throw new GitHubError(`GitHub returned ${res.status}.`, res.status);
}

/**
 * Total commit count, without downloading the history.
 *
 * Trick: ask for one commit per page, then read the page number of the `last`
 * link. Page count with a page size of one is the commit count.
 */
async function countCommits(ref: RepoRef, branch: string): Promise<number> {
  const res = await gh(
    `/repos/${ref.owner}/${ref.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`,
  );
  const link = res.headers.get("link");
  const last = link?.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (last) return Number(last[1]);

  // No `last` link means the results fit on one page — so 0 or 1 commits.
  const body = (await res.json()) as unknown[];
  return body.length;
}

function toCommit(raw: RawCommit): Commit {
  return {
    sha: raw.sha.slice(0, 7),
    // Commit bodies are often long; the subject carries the signal.
    message: raw.commit.message.split("\n")[0].slice(0, 200),
    date: raw.commit.author?.date ?? raw.commit.committer?.date ?? "",
    author: raw.author?.login ?? raw.commit.author?.name ?? "unknown",
  };
}

interface RawCommit {
  sha: string;
  commit: {
    message: string;
    author: { date: string; name: string } | null;
    committer: { date: string; name: string } | null;
  };
  author: { login: string } | null;
}

async function fetchCommitPage(
  ref: RepoRef,
  branch: string,
  page: number,
  perPage: number,
): Promise<Commit[]> {
  const res = await gh(
    `/repos/${ref.owner}/${ref.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}&page=${page}`,
  );
  const raw = (await res.json()) as RawCommit[];
  return raw.map(toCommit);
}

/** Roughly how many commits we're willing to put in front of the model. */
const MAX_COMMITS = 300;
const PAGE_SIZE = 100;

/**
 * Pull a representative set of commits.
 *
 * Small repos come back whole. Large ones get evenly spaced windows across the
 * full range, so the model sees the beginning and middle of the project rather
 * than only last week. Commits come back newest-first from the API, so page 1
 * is "now" and the last page is the first commit ever.
 */
async function sampleCommits(
  ref: RepoRef,
  branch: string,
  total: number,
): Promise<{ commits: Commit[]; sampled: boolean }> {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total <= MAX_COMMITS) {
    const pages = await Promise.all(
      Array.from({ length: totalPages }, (_, i) =>
        fetchCommitPage(ref, branch, i + 1, PAGE_SIZE),
      ),
    );
    return { commits: pages.flat(), sampled: false };
  }

  // Twelve windows of 25 keeps us near MAX_COMMITS while still touching every
  // era of the project. Always include page 1 (newest) and the final page
  // (the first commits) so the story has both endpoints.
  const windows = 12;
  const perWindow = Math.floor(MAX_COMMITS / windows);
  const targets = new Set<number>([1, totalPages]);
  for (let i = 0; i < windows; i++) {
    targets.add(1 + Math.round((i * (totalPages - 1)) / (windows - 1)));
  }

  const pageNumbers = [...targets].sort((a, b) => a - b);
  const pages = await Promise.all(
    pageNumbers.map((page) =>
      fetchCommitPage(ref, branch, page, PAGE_SIZE).then((c) =>
        c.slice(0, perWindow),
      ),
    ),
  );

  return { commits: pages.flat(), sampled: true };
}

interface RawRepo {
  full_name: string;
  description: string | null;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  created_at: string;
  pushed_at: string;
  language: string | null;
  topics?: string[];
  license: { spdx_id: string } | null;
  fork: boolean;
  default_branch: string;
}

export async function fetchHistory(input: string): Promise<RepoHistory> {
  const ref = parseRepoRef(input);

  const repoRes = await gh(`/repos/${ref.owner}/${ref.repo}`);
  const raw = (await repoRes.json()) as RawRepo;
  const branch = raw.default_branch;

  // Languages and tags are nice-to-have context — a failure there shouldn't
  // sink the whole request.
  const [languages, tags, total] = await Promise.all([
    gh(`/repos/${ref.owner}/${ref.repo}/languages`)
      .then((r) => r.json() as Promise<Record<string, number>>)
      .then((l) =>
        Object.entries(l)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([name]) => name),
      )
      .catch(() => [] as string[]),
    gh(`/repos/${ref.owner}/${ref.repo}/tags?per_page=30`)
      .then((r) => r.json() as Promise<{ name: string; commit: { sha: string } }[]>)
      .then((t) => t.map((tag) => ({ name: tag.name, sha: tag.commit.sha.slice(0, 7) })))
      .catch(() => [] as Tag[]),
    countCommits(ref, branch),
  ]);

  if (total === 0) {
    throw new GitHubError("That repo has no commits yet — nothing to tell.", 422);
  }

  const { commits, sampled } = await sampleCommits(ref, branch, total);

  return {
    ref,
    meta: {
      fullName: raw.full_name,
      description: raw.description,
      homepage: raw.homepage,
      stars: raw.stargazers_count,
      forks: raw.forks_count,
      createdAt: raw.created_at,
      pushedAt: raw.pushed_at,
      language: raw.language,
      languages,
      topics: raw.topics ?? [],
      license: raw.license?.spdx_id ?? null,
      isFork: raw.fork,
      defaultBranch: branch,
    },
    commits,
    tags,
    totalCommits: total,
    sampled,
  };
}
