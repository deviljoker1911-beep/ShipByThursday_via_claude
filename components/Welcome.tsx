"use client";

const STARTERS = [
  "We have three days to ship something people will pay for. Pitch me options and argue about them.",
  "Here's our idea: a tool that turns a repo's commit history into a readable build story. Pressure-test it.",
  "What's the smallest version of our product we could put in front of ten real users by Thursday?",
  "Read github.com/sveltejs/svelte and tell me what its history says about how the team works.",
];

export function Welcome({
  hasKey,
  onOpenSettings,
  onPick,
}: {
  hasKey: boolean;
  onOpenSettings: () => void;
  onPick: (prompt: string) => void;
}) {
  return (
    <div className="py-8">
      <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance text-[#f7f2ec] sm:text-4xl">
        A room full of colleagues
        <br />
        <span className="text-(--color-muted)">who disagree with each other.</span>
      </h1>

      <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-(--color-muted)">
        Not one assistant — a working session. A founder who kills ideas, an
        engineer who runs the code and says what will break, a PM who cuts scope.
        They search the web, execute real code, read repos, and hand work to each
        other when it isn&rsquo;t theirs.
      </p>

      {hasKey ? (
        <div className="mt-8">
          <p className="mb-3 text-[11px] font-medium tracking-[0.12em] text-[#5f574f] uppercase">
            Start with
          </p>
          <div className="flex flex-col gap-2">
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => onPick(s)}
                className="rounded-lg border border-(--color-edge) px-4 py-3 text-left text-[14px] leading-snug text-(--color-muted) transition-colors hover:border-(--color-ember) hover:text-[#f2ece5]"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-(--color-edge) bg-(--color-surface) p-5">
          <p className="text-sm font-medium text-[#f2ece5]">
            Bring your own Anthropic API key
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-(--color-muted)">
            Everything runs in your browser against your own key — there is no
            server here, no account, and nothing for anyone to leak. You pay
            Anthropic directly for exactly what the room uses, and the running
            total sits in the header.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-[#5f574f]">
            Note that a Claude Pro or Max subscription doesn&rsquo;t include API
            access — that&rsquo;s billed separately through the{" "}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-(--color-ember)"
            >
              Anthropic Console
            </a>
            .
          </p>
          <button
            onClick={onOpenSettings}
            className="mt-4 rounded-lg bg-(--color-ember) px-4 py-2.5 text-sm font-medium text-[#1a0d03] transition-opacity hover:opacity-90"
          >
            Add your key
          </button>
        </div>
      )}
    </div>
  );
}
