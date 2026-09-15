import { fetchHistory, GitHubError } from "@/lib/github";
import { streamStory } from "@/lib/claude";

// Reading a large history and generating over it takes well past the default.
export const maxDuration = 300;

function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(
      "ANTHROPIC_API_KEY isn't set on the server. Copy .env.example to .env.local and add your key.",
      500,
    );
  }

  let repo: string;
  try {
    const body = (await request.json()) as { repo?: unknown };
    if (typeof body.repo !== "string") return fail("Send a `repo` string.", 400);
    repo = body.repo;
  } catch {
    return fail("Expected a JSON body.", 400);
  }

  // Fetch before streaming so a bad repo gets a real status code and a clean
  // error, rather than a 200 with an apology inside the stream.
  let history;
  try {
    history = await fetchHistory(repo);
  } catch (err) {
    if (err instanceof GitHubError) return fail(err.message, err.status);
    console.error("github fetch failed", err);
    return fail("Couldn't reach GitHub.", 502);
  }

  const encoder = new TextEncoder();
  const meta = {
    fullName: history.meta.fullName,
    totalCommits: history.totalCommits,
    sampledCommits: history.commits.length,
    sampled: history.sampled,
    createdAt: history.meta.createdAt,
    stars: history.meta.stars,
  };

  const stream = new ReadableStream({
    async start(controller) {
      // First line is a JSON header the client parses for the stats bar;
      // everything after the newline is story text.
      controller.enqueue(encoder.encode(JSON.stringify(meta) + "\n"));
      try {
        for await (const chunk of streamStory(history)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        console.error("story generation failed", err);
        // The response is already committed at this point, so the only way to
        // surface a failure is inside the body.
        controller.enqueue(
          encoder.encode(
            `\n\n---\n\n**The story stopped early.** ${
              err instanceof Error ? err.message : "Something failed mid-generation."
            }`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
