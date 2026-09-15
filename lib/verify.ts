import Anthropic from "@anthropic-ai/sdk";
import { getBot } from "./bots";
import { fetchHistory, buildDigest, GitHubError } from "./github";
import { getModel, ZERO_USAGE, addUsage, type Usage } from "./models";

/**
 * Capability checks.
 *
 * The question these answer is narrow and worth stating precisely: does a bot
 * actually hold the tool its role claims, and does that tool really execute?
 *
 * They do NOT answer whether a bot's judgment is any good. Judgment is a prompt,
 * not a capability, and nothing here can test it.
 *
 * Each probe is checked two ways:
 *
 *   structural — did the tool genuinely run? (a tool_use block is present in the
 *                raw response, not merely described in prose)
 *   factual    — does the answer match a truth we computed independently?
 *
 * The structural check alone is not enough. A model with no sandbox will happily
 * narrate plausible, wrong output. The factual check is what separates executing
 * from improvising, which is why the probes ask for values that cannot be
 * guessed: a SHA-256 digest, a real commit sha.
 */

export type ProbeStatus = "pending" | "running" | "pass" | "fail" | "error";

export interface ProbeResult {
  id: string;
  label: string;
  what: string;
  botId: string;
  status: ProbeStatus;
  /** Why it passed or failed, in plain language. */
  verdict: string;
  /** Raw model output, so the user can judge for themselves. */
  answer: string;
  /** Tools the model actually invoked, read off the response blocks. */
  toolsUsed: string[];
  /** The independently-established truth this was checked against. */
  expected?: string;
  /** Something the user can go and check by hand. */
  checkYourself?: string;
  usage: Usage;
}

const PROBE_TEXT = "ShipByThursday";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface RawRun {
  text: string;
  toolsUsed: string[];
  usage: Usage;
}

/**
 * One non-streaming call, returning the text plus which tools actually fired.
 *
 * Reading tool use off the response blocks is the whole point — asking the model
 * "did you run it?" is worthless, because a model that didn't will say yes.
 */
async function run(
  client: Anthropic,
  modelId: string,
  tools: Anthropic.Beta.BetaToolUnion[],
  prompt: string,
  opts: { betas?: string[]; signal?: AbortSignal } = {},
): Promise<RawRun> {
  const model = getModel(modelId);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: prompt },
  ];

  let text = "";
  const toolsUsed: string[] = [];
  let usage = ZERO_USAGE;

  // Loop so client-side tools (the repo reader) can return a result and let
  // the model finish its answer.
  for (let i = 0; i < 4; i++) {
    const res = await client.beta.messages.create(
      {
        model: modelId,
        max_tokens: 4000,
        ...(opts.betas ? { betas: opts.betas } : {}),
        ...(model.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
        ...(model.effort ? { output_config: { effort: "low" as const } } : {}),
        tools,
        messages,
      },
      { signal: opts.signal },
    );

    usage = addUsage(usage, {
      inputTokens: res.usage.input_tokens ?? 0,
      outputTokens: res.usage.output_tokens ?? 0,
      cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
    });

    for (const block of res.content) {
      if (block.type === "text") text += block.text;
      if (block.type === "server_tool_use" || block.type === "tool_use") {
        if (!toolsUsed.includes(block.name)) toolsUsed.push(block.name);
      }
    }

    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }

    if (res.stop_reason !== "tool_use") break;

    const calls = res.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      if (call.name === "read_repo_history") {
        const { repo } = call.input as { repo: string };
        try {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: buildDigest(await fetchHistory(repo)),
          });
        } catch (err) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: err instanceof GitHubError ? err.message : "GitHub unreachable.",
          });
        }
      } else {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          is_error: true,
          content: `Unknown tool: ${call.name}`,
        });
      }
    }
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: results });
  }

  return { text: text.trim(), toolsUsed, usage };
}

const REPO_TOOL: Anthropic.Beta.BetaToolUnion = {
  name: "read_repo_history",
  description:
    "Read a public GitHub repository's commit history: metadata, release tags, and a sample of commits spanning the project's life.",
  input_schema: {
    type: "object",
    properties: { repo: { type: "string", description: "owner/repo or a GitHub URL" } },
    required: ["repo"],
    additionalProperties: false,
  },
  strict: true,
};

export interface ProbeContext {
  client: Anthropic;
  modelId: string;
  signal?: AbortSignal;
}

type Probe = (ctx: ProbeContext) => Promise<Omit<ProbeResult, "id" | "label" | "what" | "botId">>;

/**
 * Does the sandbox actually execute?
 *
 * A SHA-256 digest cannot be produced by a language model from memory, so an
 * exact match is strong evidence that real code ran. A near-miss is the
 * signature of a model improvising.
 */
const probeSandbox: Probe = async ({ client, modelId, signal }) => {
  const expected = await sha256Hex(PROBE_TEXT);
  const { text, toolsUsed, usage } = await run(
    client,
    modelId,
    [{ type: "code_execution_20260521", name: "code_execution" }],
    `Run exactly this Python in your sandbox and reply with only the output, nothing else:\n\nimport hashlib\nprint(hashlib.sha256(b"${PROBE_TEXT}").hexdigest())`,
    { betas: ["code-execution-2025-08-25"], signal },
  );

  const ran = toolsUsed.includes("code_execution");
  const correct = text.toLowerCase().includes(expected);

  return {
    status: ran && correct ? "pass" : "fail",
    verdict: !ran
      ? "No code execution tool call appeared in the response — nothing ran."
      : correct
        ? "Code executed in a real sandbox and returned the correct digest."
        : "The tool ran but the digest is wrong, which should not happen. Treat the output as unreliable.",
    answer: text,
    toolsUsed,
    expected,
    checkYourself: `Run this in a terminal: echo -n '${PROBE_TEXT}' | shasum -a 256`,
    usage,
  };
};

/** Did a real search happen, with sources, or was it answered from memory? */
const probeSearch: Probe = async ({ client, modelId, signal }) => {
  const { text, toolsUsed, usage } = await run(
    client,
    modelId,
    [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    "Search the web for news published in the last seven days about artificial intelligence. Reply with one headline and the full URL you got it from. If you did not search, say so.",
    { signal },
  );

  const searched = toolsUsed.includes("web_search");
  const hasUrl = /https?:\/\/[^\s)]+/.test(text);

  return {
    status: searched && hasUrl ? "pass" : "fail",
    verdict: !searched
      ? "No search tool call appeared — this was answered from training data."
      : hasUrl
        ? "A live web search ran and returned a source URL."
        : "Search ran but produced no citable URL.",
    answer: text,
    toolsUsed,
    checkYourself: "Open the URL it returned. It should exist and be recent.",
    usage,
  };
};

/** Did it fetch the page, or recite what it remembers the page saying? */
const probeFetch: Probe = async ({ client, modelId, signal }) => {
  const { text, toolsUsed, usage } = await run(
    client,
    modelId,
    [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }],
    "Fetch https://example.com and reply with the exact text of its <h1> heading, nothing else.",
    { signal },
  );

  const fetched = toolsUsed.includes("web_fetch");
  const correct = text.toLowerCase().includes("example domain");

  return {
    status: fetched && correct ? "pass" : "fail",
    verdict: !fetched
      ? "No fetch tool call appeared — the page was never retrieved."
      : correct
        ? "The page was fetched and the heading matches."
        : "Fetch ran but the heading doesn't match the real page.",
    answer: text,
    toolsUsed,
    expected: "Example Domain",
    checkYourself: "Open https://example.com — the heading reads 'Example Domain'.",
    usage,
  };
};

/**
 * Did it really read the repo?
 *
 * We fetch the same history ourselves and compare the oldest commit sha. A sha
 * is unguessable, so a match means the tool result genuinely reached the model.
 */
const probeRepo: Probe = async ({ client, modelId, signal }) => {
  const repo = "sveltejs/svelte";
  let expected = "";
  try {
    const history = await fetchHistory(repo);
    expected = history.commits[history.commits.length - 1]?.sha ?? "";
  } catch (err) {
    return {
      status: "error" as const,
      verdict: `Couldn't reach GitHub to establish the expected answer: ${
        err instanceof Error ? err.message : "unknown error"
      }`,
      answer: "",
      toolsUsed: [],
      usage: ZERO_USAGE,
    };
  }

  const { text, toolsUsed, usage } = await run(
    client,
    modelId,
    [REPO_TOOL],
    `Use read_repo_history on ${repo}. Then reply with only the 7-character sha of the OLDEST commit in what you were given.`,
    { signal },
  );

  const used = toolsUsed.includes("read_repo_history");
  const correct = expected !== "" && text.toLowerCase().includes(expected.toLowerCase());

  return {
    status: used && correct ? "pass" : "fail",
    verdict: !used
      ? "The repo tool was never called."
      : correct
        ? "The repo was read and the commit sha matches GitHub exactly."
        : `The tool ran but the sha doesn't match. Expected ${expected}.`,
    answer: text,
    toolsUsed,
    expected,
    checkYourself: `Compare against github.com/${repo} — that sha should be a real commit.`,
    usage,
  };
};

export interface ProbeDef {
  id: string;
  label: string;
  what: string;
  botId: string;
  run: Probe;
}

export const PROBES: ProbeDef[] = [
  {
    id: "sandbox",
    label: "Code actually executes",
    what: "Asks for a SHA-256 digest, which no model can produce from memory. An exact match means real code ran.",
    botId: "engineer",
    run: probeSandbox,
  },
  {
    id: "repo",
    label: "Repositories are really read",
    what: "Fetches the same history independently and compares commit shas. A sha can't be guessed.",
    botId: "engineer",
    run: probeRepo,
  },
  {
    id: "search",
    label: "The web is really searched",
    what: "Asks for news from the last week with a URL, and checks a search call actually fired.",
    botId: "founder",
    run: probeSearch,
  },
  {
    id: "fetch",
    label: "Pages are really fetched",
    what: "Retrieves a page with known contents and compares the heading.",
    botId: "pm",
    run: probeFetch,
  },
];

export function makeClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export function probeBotName(botId: string): string {
  return getBot(botId)?.name ?? botId;
}

/**
 * Does a handoff actually transfer control?
 *
 * This one tests the orchestration rather than a tool. We watch the event
 * stream for a real `handoff` event and confirm a different bot then speaks —
 * a bot saying "I'll pass this to Kai" in prose proves nothing.
 */
export async function runHandoffProbe(opts: {
  apiKey: string;
  modelId: string;
  effort: "low" | "medium" | "high";
  signal?: AbortSignal;
}): Promise<ProbeResult> {
  const { runRoom } = await import("./agent");
  const roster = ["founder", "engineer"];

  let handedOff: { from: string; to: string } | null = null;
  const spoke = new Set<string>();
  let transcript = "";
  let usage = ZERO_USAGE;

  try {
    for await (const event of runRoom({
      apiKey: opts.apiKey,
      modelId: opts.modelId,
      effort: opts.effort,
      roster,
      transcript: [
        {
          kind: "human",
          text: "Ada, I need someone to actually write and run the code for a prime sieve. That isn't your job — get Kai on it.",
        },
      ],
      startBotId: "founder",
      maxBotTurns: 3,
      signal: opts.signal,
    })) {
      if (event.type === "handoff" && !handedOff) {
        handedOff = { from: event.from, to: event.to };
      }
      if (event.type === "bot_end" && event.text) {
        spoke.add(event.botId);
        transcript += `${probeBotName(event.botId)}: ${event.text}\n\n`;
      }
      if (event.type === "usage") usage = event.usage;
      if (event.type === "error") {
        return {
          id: "handoff",
          label: "Work is really handed between bots",
          what: "Watches the event stream for a genuine control transfer, not a promise to transfer.",
          botId: "founder",
          status: "error",
          verdict: event.message,
          answer: transcript.trim(),
          toolsUsed: [],
          usage,
        };
      }
    }
  } catch (err) {
    return {
      id: "handoff",
      label: "Work is really handed between bots",
      what: "Watches the event stream for a genuine control transfer.",
      botId: "founder",
      status: "error",
      verdict: err instanceof Error ? err.message : "Unknown failure.",
      answer: transcript.trim(),
      toolsUsed: [],
      usage,
    };
  }

  const transferred = handedOff !== null && spoke.size > 1;

  return {
    id: "handoff",
    label: "Work is really handed between bots",
    what: "Watches the event stream for a genuine control transfer, not a promise to transfer.",
    botId: "founder",
    status: transferred ? "pass" : "fail",
    verdict: transferred
      ? `${probeBotName(handedOff!.from)} handed off to ${probeBotName(handedOff!.to)}, and both spoke.`
      : handedOff
        ? "A handoff fired but only one bot ever spoke."
        : "No handoff event — control never left the first bot.",
    answer: transcript.trim(),
    toolsUsed: handedOff ? ["hand_off"] : [],
    checkYourself: "Two differently-coloured names should appear in the answer below.",
    usage,
  };
}
