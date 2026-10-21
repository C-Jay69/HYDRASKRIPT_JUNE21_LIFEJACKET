import {
  BookOpen,
  Cloud,
  Heart,
  PawPrint,
  Sparkles,
  Star,
  Sun,
} from "lucide-react";

/* Soft drifting decorations behind the book */
function FloatingDecor() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {/* warm color washes */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(255,240,200,0.95),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_100%,rgba(178,135,90,0.30),transparent_60%)]" />

      {/* playful icons */}
      <Sun
        className="absolute left-[7%] top-[7%] h-11 w-11 animate-float-slower text-sunshine/60"
        strokeWidth={1.5}
      />
      <Cloud
        className="absolute right-[8%] top-[11%] h-12 w-12 animate-float-slow text-white/90"
        strokeWidth={1.5}
      />
      <Cloud
        className="absolute bottom-[14%] left-[12%] h-8 w-8 animate-float-slower text-white/70"
        strokeWidth={1.5}
      />
      <Sparkles
        className="absolute bottom-[20%] right-[15%] h-6 w-6 animate-wiggle text-butter/80"
        strokeWidth={1.8}
      />
      <Star
        className="absolute left-[21%] top-[24%] h-5 w-5 animate-float-slow text-sunshine/40"
        fill="currentColor"
        strokeWidth={0}
      />
      <PawPrint
        className="absolute right-[23%] top-[32%] h-6 w-6 rotate-12 text-barn/15"
        strokeWidth={1.8}
      />
      <Heart
        className="absolute left-[9%] top-[46%] h-5 w-5 animate-float-slow text-barn/20"
        fill="currentColor"
        strokeWidth={0}
      />
    </div>
  );
}

/* The storybook page itself — horizontal split: illustration / text */
function BookPage() {
  return (
    <div className="animate-rise relative aspect-[3/4] w-[min(92vw,70vh,820px)]">
      <div className="paper-texture relative flex h-full w-full flex-col overflow-hidden rounded-[14px] shadow-[0_35px_70px_-20px_rgba(61,51,39,0.5),0_10px_25px_-10px_rgba(61,51,39,0.3)] ring-1 ring-ink/15">
        {/* binding shadow along the spine */}
        <div className="spine-shadow pointer-events-none absolute inset-y-0 left-0 z-20 w-12" />

        {/* ── top half · illustration ─────────────────────────── */}
        <div
          className="animate-rise relative h-1/2 p-3 pb-0 sm:p-5 sm:pb-0"
          style={{ animationDelay: "0.15s" }}
        >
          <div className="relative h-full w-full">
            <div className="relative h-full w-full overflow-hidden rounded-lg shadow-[inset_0_0_0_4px_rgba(255,255,255,0.9),0_10px_25px_-8px_rgba(61,51,39,0.35)] ring-1 ring-ink/10">
              <img
                src="/images/farm-adventure.png"
                alt="A joyful girl in overalls running through a sunny farm meadow with her golden retriever puppy"
                className="h-full w-full object-cover"
              />
              {/* warm vignette */}
              <div className="illustration-warmth absolute inset-0" />
            </div>

            {/* washi-tape corners */}
            <div className="absolute -top-2.5 left-10 z-10 h-5 w-16 -rotate-6 rounded-[2px] bg-butter/85 shadow-sm" />
            <div className="absolute -top-2.5 right-10 z-10 h-5 w-16 rotate-3 rounded-[2px] bg-skyblue/75 shadow-sm" />
          </div>
        </div>

        {/* ── bottom half · the story ─────────────────────────── */}
        <div
          className="animate-rise relative flex flex-1 flex-col px-5 pb-4 pt-3 sm:px-8 sm:pb-5 sm:pt-4"
          style={{ animationDelay: "0.3s" }}
        >
          {/* running head */}
          <p className="text-center font-display text-[9px] font-medium uppercase tracking-[0.4em] text-ink/40 sm:text-[11px]">
            Lily &amp; Biscuit
          </p>

          {/* chapter title */}
          <div className="mt-1.5 flex items-center justify-center gap-2.5 sm:mt-2">
            <PawPrint className="h-3.5 w-3.5 text-barn/50 sm:h-4 sm:w-4" />
            <h1 className="font-story text-lg font-extrabold text-barn sm:text-xl">
              The Meadow Run
            </h1>
            <PawPrint className="h-3.5 w-3.5 -scale-x-100 text-barn/50 sm:h-4 sm:w-4" />
          </div>

          {/* story text */}
          <div className="mt-3 space-y-2.5 font-story text-[12.5px] leading-relaxed text-ink min-[480px]:text-[14px] sm:mt-4 sm:space-y-3 sm:text-[15px] md:text-base">
            <p className="drop-cap">
              One golden morning, Lily raced across the meadow with her best
              friend Biscuit bounding at her heels.{" "}
              <span className="story-word">“Faster, Biscuit, faster!”</span>{" "}
              she giggled, and the tall grass tickled her boots.
            </p>
            <p className="hidden min-[420px]:block">
              They chased butterflies past the{" "}
              <span className="story-word">big red barn</span>, counted three
              fluffy sheep, and rolled down the hill until the whole world spun
              with giggles.
            </p>
            <p>
              At last they flopped beneath the old oak tree, happy and out of
              breath. <span className="story-word">“Best day ever,”</span>{" "}
              whispered Lily — and Biscuit thumped his tail in agreement.
            </p>
          </div>

          {/* page footer */}
          <div
            className="animate-rise mt-auto flex items-center justify-center gap-4 pt-3"
            style={{ animationDelay: "0.45s" }}
          >
            <PawPrint className="h-4 w-4 text-ink/20" />
            <span className="grid h-8 w-8 place-items-center rounded-full bg-barn font-display text-sm font-semibold text-cream shadow-[0_2px_6px_rgba(192,57,43,0.4)]">
              12
            </span>
            <PawPrint className="h-4 w-4 -scale-x-100 text-ink/20" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#e8dcc3] font-body text-ink">
      <FloatingDecor />

      <main className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-5 px-4 py-10 sm:gap-6">
        <BookPage />

        <p
          className="animate-rise flex items-center gap-2 text-center font-body text-xs text-ink/50 sm:text-sm"
          style={{ animationDelay: "0.55s" }}
        >
          <BookOpen className="h-4 w-4" />
          <span>
            Sample interior page — “Lily &amp; Biscuit”, page 12 of 32
          </span>
        </p>
      </main>
    </div>
  );
}
