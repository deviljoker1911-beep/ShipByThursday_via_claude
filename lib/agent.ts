import Anthropic from "@anthropic-ai/sdk";
import type { Bot, ToolName } from "./bots";
import { getBot } from "./bots";
import { getModel, ZERO_USAGE, addUsage, type Usage } from "./models";
import { fetchHistory, buildDigest, GitHubError } from "./github";

/**
 * Multi-bot orchestration.
 *
 * The transcript is stored as plain text turns, not as API message objects.
 * Each bot's view of the room is rebuilt from that transcript on every turn:
 * its own turns become `assistant`, everyone else's become `user` with a
 * speaker prefix. That keeps handoffs cheap — we can abandon a bot's in-flight
 * message list the moment it passes the work on, because nothing depends on it.
 */

export type Turn =
  | { kind: "human"; text: string }
  | { kind: "bot"; botId: string; text: string }
  | { kind: "handoff"; from: string; to: string; brief: string };

export type AgentEvent =
  | { type: "bot_start"; botId: string }
  | { type: "text"; botId: string; delta: string }
  | { type: "tool"; botId: string; tool: string; detail: string }
  | { type: "bot_end"; botId: string; text: string }
  | { type: "handoff"; from: string; to: string; brief: string }
  | { type: "usage"; usage: Usage }
  | { type: "error"; message: string }
  | { type: "done"; reason: "yielded" | "turn_limit" };

export interface RunOptions {
  apiKey: string;
  modelId: string;
  effort: "low" | "medium" | "high";
  roster: string[];
  transcript: Turn[];
  startBotId: string;
  /** Hard cap on bot turns per human message, so a handoff loop can't drain a wallet. */
  maxBotTurns: number;
  signal?: AbortSignal;
}

const MAX_TOOL_ITERATIONS = 8;

function speakerLabel(botId: string): string {
  const bot = getBot(botId);
  return bot ? `${bot.name} · ${bot.role}` : botId;
}

/**
 * Rebuild one bot's view of the room.
 *
 * The API requires strictly alternating roles starting with `user`, so
 * consecutive turns on the same side get merged.
 */
export function viewFor(botId: string, transcript: Turn[]): Anthropic.Beta.BetaMessageParam[] {
  const flat: { role: "user" | "assistant"; text: string }[] = [];

  for (const turn of transcript) {
    if (turn.kind === "human") {
      flat.push({ role: "user", text: turn.text });
    } else if (turn.kind === "bot") {
      flat.push(
        turn.botId === botId
          ? { role: "assistant", text: turn.text }
          : { role: "user", text: `[${speakerLabel(turn.botId)}]: ${turn.text}` },
      );
    } else {
      const note = `[${speakerLabel(turn.from)} → ${speakerLabel(turn.to)}]: ${turn.brief}`;
      flat.push(
        turn.from === botId
          ? { role: "assistant", text: note }
          : { role: "user", text: note },
      );
    }
  }

  // A view that opens on `assistant` is invalid; give it something to answer.
  if (flat.length && flat[0].role === "assistant") {
    flat.unshift({ role: "user", text: "(You are joining the room mid-conversation.)" });
  }

  const merged: Anthropic.Beta.BetaMessageParam[] = [];
  for (const entry of flat) {
    const last = merged[merged.length - 1];
    if (last && last.role === entry.role) {
      last.content = `${last.content as string}\n\n${entry.text}`;
    } else {
      merged.push({ role: entry.role, content: entry.text });
    }
  }
  return merged;
}

function systemFor(bot: Bot, roster: string[]): string {
  const others = roster
    .filter((id) => id !== bot.id)
    .map((id) => {
      const b = getBot(id);
      return b ? `- ${b.name} (${b.role}) — ${b.tagline} [id: ${b.id}]` : null;
    })
    .filter(Boolean)
    .join("\n");

  return `${bot.persona}

## The room

You are ${bot.name}, in a working session with a human and these teammates:

${others || "(nobody else right now — it's just you and the human)"}

Messages from others are prefixed with their name and role. Unprefixed messages are from the human.

## How to behave in a room

You are in a conversation, not writing a document. Two to five sentences is normal. Write more only when asked for something that genuinely needs length, and never pad.

Address teammates by name when you're responding to them, and disagree when you disagree — a room where everyone concurs is worthless. Don't restate what someone just said before adding to it.

${
  others
    ? `When the work needs someone else's judgment or hands, call \`hand_off\` with their id and a brief. The brief is what they'll act on, so make it specific: what you need and why. Don't hand off just to be polite, and don't hand off work you could do yourself.`
    : ``
}

When you've said your piece and it's the human's turn, simply stop. Don't announce that you're stopping, and don't ask "shall I proceed?" — if you should proceed, proceed.`;
}

function toolsFor(bot: Bot, modelId: string, roster: string[]): Anthropic.Beta.BetaToolUnion[] {
  const model = getModel(modelId);
  const tools: Anthropic.Beta.BetaToolUnion[] = [];
  const has = (t: ToolName) => bot.tools.includes(t);

  // The 2026 web tools run code execution internally for dynamic filtering, so
  // declaring both puts two execution environments in front of the model. Bots
  // that need a real sandbox take the basic web tools instead.
  const wantsSandbox = has("code_execution");
  const modernWeb = model.modernWebTools && !wantsSandbox;

  if (has("web_search")) {
    tools.push(
      modernWeb
        ? { type: "web_search_20260209", name: "web_search", max_uses: 6 }
        : { type: "web_search_20250305", name: "web_search", max_uses: 6 },
    );
  }
  if (has("web_fetch")) {
    tools.push(
      modernWeb
        ? { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 }
        : { type: "web_fetch_20250910", name: "web_fetch", max_uses: 6 },
    );
  }
  if (wantsSandbox) {
    tools.push({ type: "code_execution_20260521", name: "code_execution" });
  }
  if (has("read_repo_history")) {
    tools.push({
      name: "read_repo_history",
      description:
        "Read a public GitHub repository's commit history: metadata, release tags, and a representative sample of commits spanning the project's whole life. Use when the conversation concerns an existing codebase.",
      input_schema: {
        type: "object",
        properties: {
          repo: {
            type: "string",
            description: "A GitHub URL or owner/repo, e.g. sveltejs/svelte",
          },
        },
        required: ["repo"],
        additionalProperties: false,
      },
      strict: true,
    });
  }

  const peers = roster.filter((id) => id !== bot.id);
  if (peers.length) {
    tools.push({
      name: "hand_off",
      description:
        "Pass the work to a teammate. Use when the next step genuinely needs their remit. Your turn ends when you call this.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string", enum: peers, description: "Teammate's id." },
          brief: {
            type: "string",
            description:
              "What you need from them and why. Specific enough to act on without re-reading the thread.",
          },
        },
        required: ["to", "brief"],
        additionalProperties: false,
      },
      strict: true,
    });
  }

  return tools;
}

interface TurnResult {
  text: string;
  handoff?: { to: string; brief: string };
  usage: Usage;
}

async function* runBotTurn(
  bot: Bot,
  client: Anthropic,
  opts: RunOptions,
): AsyncGenerator<AgentEvent, TurnResult, unknown> {
  const model = getModel(opts.modelId);
  const messages = viewFor(bot.id, opts.transcript);
  const tools = toolsFor(bot, opts.modelId, opts.roster);
  const needsSandboxBeta = bot.tools.includes("code_execution");

  let text = "";
  let usage = ZERO_USAGE;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const stream = client.beta.messages.stream(
      {
        model: opts.modelId,
        max_tokens: 8000,
        ...(needsSandboxBeta ? { betas: ["code-execution-2025-08-25"] } : {}),
        ...(model.adaptiveThinking ? { thinking: { type: "adaptive" as const } } : {}),
        ...(model.effort ? { output_config: { effort: opts.effort } } : {}),
        system: [
          {
            type: "text",
            text: systemFor(bot, opts.roster),
            cache_control: { type: "ephemeral" },
          },
        ],
        tools,
        messages,
      },
      { signal: opts.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        yield { type: "text", botId: bot.id, delta: event.delta.text };
      }
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "server_tool_use" || block.type === "tool_use") {
          const detail =
            block.name === "web_search"
              ? "searching the web"
              : block.name === "web_fetch"
                ? "reading a page"
                : block.name === "code_execution"
                  ? "running code"
                  : block.name === "read_repo_history"
                    ? "reading a repo"
                    : block.name;
          if (block.name !== "hand_off") {
            yield { type: "tool", botId: bot.id, tool: block.name, detail };
          }
        }
      }
    }

    const final = await stream.finalMessage();
    usage = addUsage(usage, {
      inputTokens: final.usage.input_tokens ?? 0,
      outputTokens: final.usage.output_tokens ?? 0,
      cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
    });
    yield { type: "usage", usage };

    if (final.stop_reason === "refusal") {
      return { text: text || "(declined to respond)", usage };
    }

    // Long server-tool sequences pause so the client can keep the connection
    // alive; hand the turn straight back to continue.
    if (final.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: final.content });
      continue;
    }

    if (final.stop_reason !== "tool_use") {
      return { text, usage };
    }

    const calls = final.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );

    const handoff = calls.find((c) => c.name === "hand_off");
    if (handoff) {
      const input = handoff.input as { to: string; brief: string };
      // The turn is over; the next bot's view gets rebuilt from the transcript,
      // so this message list can simply be dropped.
      return { text, handoff: input, usage };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      if (call.name === "read_repo_history") {
        const { repo } = call.input as { repo: string };
        try {
          const history = await fetchHistory(repo);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: buildDigest(history),
          });
        } catch (err) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content:
              err instanceof GitHubError ? err.message : "Could not reach GitHub.",
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

    messages.push({ role: "assistant", content: final.content });
    messages.push({ role: "user", content: results });
  }

  return { text, usage };
}

/**
 * Run the room until a bot yields back to the human or the turn cap is hit.
 */
export async function* runRoom(opts: RunOptions): AsyncGenerator<AgentEvent, void, unknown> {
  const client = new Anthropic({
    apiKey: opts.apiKey,
    // The key lives in the user's browser and is sent only to api.anthropic.com.
    // There is no server in this product that could hold it.
    dangerouslyAllowBrowser: true,
  });

  const transcript = [...opts.transcript];
  let active = opts.startBotId;

  for (let turn = 0; turn < opts.maxBotTurns; turn++) {
    const bot = getBot(active);
    if (!bot) {
      yield { type: "error", message: `No such bot: ${active}` };
      return;
    }

    yield { type: "bot_start", botId: bot.id };

    let result: TurnResult;
    try {
      const gen = runBotTurn(bot, client, { ...opts, transcript });
      let next = await gen.next();
      while (!next.done) {
        yield next.value;
        next = await gen.next();
      }
      result = next.value;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      yield { type: "error", message: describeError(err) };
      return;
    }

    if (result.text.trim()) {
      transcript.push({ kind: "bot", botId: bot.id, text: result.text.trim() });
    }
    yield { type: "bot_end", botId: bot.id, text: result.text.trim() };

    if (!result.handoff) {
      yield { type: "done", reason: "yielded" };
      return;
    }

    const { to, brief } = result.handoff;
    transcript.push({ kind: "handoff", from: bot.id, to, brief });
    yield { type: "handoff", from: bot.id, to, brief };
    active = to;
  }

  yield { type: "done", reason: "turn_limit" };
}

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) {
    return "That API key was rejected. Check it in Settings — it should start with sk-ant-.";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Your key doesn't have access to this model. Try Sonnet or Haiku in Settings.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Anthropic rate-limited the request. Wait a moment and try again.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    return `Anthropic rejected the request: ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach Anthropic. Check your connection.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Anthropic returned ${err.status ?? "an error"}: ${err.message}`;
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
