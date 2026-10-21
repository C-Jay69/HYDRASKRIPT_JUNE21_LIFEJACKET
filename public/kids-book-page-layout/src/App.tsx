import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  PawPrint,
  Sparkles,
  Volume2,
  VolumeX,
  Sun,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Story data                                                         */
/* ------------------------------------------------------------------ */

type StoryPage = {
  image: string;
  alt: string;
  chapter: string;
  title: string;
  paragraphs: string[];
  sky: string; // tailwind gradient classes for the ambient sky
  accent: string; // drop cap + title color
  hill: string; // hill color behind the book
};

const PAGES: StoryPage[] = [
  {
    image: "/images/page1.png",
    alt: "Poppy running through a sunny meadow with her puppy Biscuit",
    chapter: "Chapter One",
    title: "The Great Meadow Race",
    paragraphs: [
      "Poppy woke up before the roosters did. She pulled on her yellow overalls, laced up her red boots, and tiptoed down the creaky stairs. Waiting by the door, tail wagging like a windshield wiper, was Biscuit — the fluffiest, bounciest puppy on the whole farm.",
      "“Race you to the big oak tree!” Poppy giggled. And away they went, zooming through the golden grass while butterflies danced above the wildflowers. Biscuit ran so fast his ears flew backwards like little wings. Who do you think won the race? Why — everybody did!",
    ],
    sky: "from-sky-300 via-sky-200 to-amber-100",
    accent: "text-orange-600",
    hill: "#8BC34A",
  },
  {
    image: "/images/page2.png",
    alt: "Poppy and Biscuit playing by the red barn with a piglet watching",
    chapter: "Chapter Two",
    title: "A Butterfly Named Zigzag",
    paragraphs: [
      "After the race, Biscuit spotted something orange fluttering by the barn. Zip! Zag! Zoom! It was a butterfly, and Biscuit simply had to say hello. He bounced left, he bounced right, and — boop! — he landed right in a pile of soft, warm hay.",
      "Poppy laughed so hard she snorted, and even Pickles the piglet oinked a little giggle from behind the fence. The butterfly landed gently on Biscuit's nose, as if to say, “Silly puppy, you can't catch me — but you can be my friend.”",
    ],
    sky: "from-sky-400 via-amber-100 to-orange-100",
    accent: "text-rose-600",
    hill: "#7CB342",
  },
  {
    image: "/images/page3.png",
    alt: "Poppy hugging Biscuit in the grass at sunset",
    chapter: "Chapter Three",
    title: "The Sleepy Sunset Hug",
    paragraphs: [
      "When the sky turned the color of peach jam, Poppy and Biscuit flopped down in the cool green grass. The windmill hummed a slow, sleepy song, and tiny fireflies began to twinkle on, one by one, like stars coming down to say goodnight.",
      "“Best. Day. Ever,” Poppy whispered, wrapping her arms around her warm, snuggly friend. Biscuit gave one last happy tail-wag and closed his eyes. And on Sunny Meadow Farm, under a big orange sky, the two best friends dreamed of tomorrow's adventures.",
    ],
    sky: "from-orange-300 via-rose-200 to-purple-200",
    accent: "text-purple-600",
    hill: "#558B2F",
  },
];

/* ------------------------------------------------------------------ */
/*  Ambient background pieces                                          */
/* ------------------------------------------------------------------ */

function Cloud({
  top,
  scale,
  duration,
  delay,
  opacity,
}: {
  top: string;
  scale: number;
  duration: number;
  delay: number;
  opacity: number;
}) {
  return (
    <div
      className="cloud absolute left-0"
      style={{
        top,
        transform: `scale(${scale})`,
        animationDuration: `${duration}s`,
        animationDelay: `${delay}s`,
        opacity,
      }}
      aria-hidden
    >
      <svg width="180" height="70" viewBox="0 0 180 70" fill="white">
        <ellipse cx="50" cy="48" rx="50" ry="22" />
        <ellipse cx="95" cy="34" rx="42" ry="26" />
        <ellipse cx="138" cy="50" rx="40" ry="19" />
      </svg>
    </div>
  );
}

function SunBadge() {
  return (
    <div className="bob absolute right-[6%] top-[7%] hidden md:block" aria-hidden>
      <div className="relative h-28 w-28">
        <svg className="sun-rays absolute inset-0" viewBox="0 0 112 112">
          {Array.from({ length: 12 }).map((_, i) => (
            <rect
              key={i}
              x="53"
              y="2"
              width="6"
              height="18"
              rx="3"
              fill="#FBBF24"
              transform={`rotate(${i * 30} 56 56)`}
            />
          ))}
        </svg>
        <div className="absolute inset-5 rounded-full bg-gradient-to-br from-yellow-300 to-amber-400 shadow-[0_0_40px_rgba(251,191,36,0.7)]" />
      </div>
    </div>
  );
}

function Butterfly({ className }: { className: string }) {
  return (
    <span className={`butterfly absolute text-2xl md:text-3xl ${className}`} aria-hidden>
      🦋
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main app                                                           */
/* ------------------------------------------------------------------ */

export default function App() {
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [speaking, setSpeaking] = useState(false);

  const story = PAGES[page];
  const canSpeech = typeof window !== "undefined" && "speechSynthesis" in window;

  const stopReading = useCallback(() => {
    if (canSpeech) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [canSpeech]);

  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= PAGES.length || index === page) return;
      stopReading();
      setDirection(index > page ? "next" : "prev");
      setPage(index);
    },
    [page, stopReading]
  );

  const readAloud = () => {
    if (!canSpeech) return;
    if (speaking) {
      stopReading();
      return;
    }
    const text = `${story.title}. ${story.paragraphs.join(" ")}`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.92;
    utterance.pitch = 1.1;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  };

  // keyboard page turning
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") goTo(page + 1);
      if (e.key === "ArrowLeft") goTo(page - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, goTo]);

  // stop narration when leaving the app
  useEffect(() => stopReading, [stopReading]);

  return (
    <div
      className={`relative min-h-screen overflow-hidden bg-gradient-to-b ${story.sky} transition-colors duration-1000 font-story`}
    >
      {/* ---------- ambient sky layer ---------- */}
      <SunBadge />
      <Cloud top="6%" scale={1} duration={70} delay={-12} opacity={0.9} />
      <Cloud top="16%" scale={0.65} duration={95} delay={-48} opacity={0.7} />
      <Cloud top="28%" scale={0.85} duration={80} delay={-70} opacity={0.8} />
      <Butterfly className="left-[7%] top-[38%]" />
      <Butterfly className="right-[9%] top-[55%]" />

      {/* rolling hills at the bottom */}
      <svg
        className="pointer-events-none absolute bottom-0 left-0 w-full"
        viewBox="0 0 1440 220"
        preserveAspectRatio="none"
        aria-hidden
      >
        <path
          d="M0,120 C240,40 480,180 720,120 C960,60 1200,160 1440,90 L1440,220 L0,220 Z"
          fill={story.hill}
          opacity="0.45"
          style={{ transition: "fill 1s" }}
        />
        <path
          d="M0,170 C300,100 600,210 900,150 C1140,105 1320,190 1440,150 L1440,220 L0,220 Z"
          fill={story.hill}
          opacity="0.75"
          style={{ transition: "fill 1s" }}
        />
      </svg>
      <span className="absolute bottom-4 left-[4%] text-3xl md:text-4xl" aria-hidden>🌻</span>
      <span className="absolute bottom-6 left-[12%] text-2xl" aria-hidden>🌼</span>
      <span className="absolute bottom-5 right-[6%] text-3xl md:text-4xl" aria-hidden>🌷</span>
      <span className="absolute bottom-8 right-[14%] text-2xl" aria-hidden>🌾</span>

      {/* ---------- content ---------- */}
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center px-4 py-6 sm:px-6 md:py-8">
        {/* series header */}
        <header className="mb-5 flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/70 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-amber-800 shadow-sm backdrop-blur-sm">
            <BookOpen className="h-4 w-4" aria-hidden />
            Sunny Meadow Farm Storybook
          </span>
          <h1 className="font-display mt-2 text-4xl font-extrabold leading-tight text-amber-900 drop-shadow-[0_2px_0_rgba(255,255,255,0.6)] sm:text-5xl">
            Poppy <span className="text-rose-500">&amp;</span> Biscuit
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-amber-800/80">
            <Sparkles className="h-4 w-4 text-amber-500" aria-hidden />
            A read-aloud adventure in three pages
          </p>
        </header>

        {/* ---------- the book page ---------- */}
        <main className="relative w-full">
          {/* stacked page edges behind the book */}
          <div className="absolute inset-x-3 -bottom-2.5 top-3 rotate-[0.8deg] rounded-[1.6rem] bg-amber-100 shadow-md" aria-hidden />
          <div className="absolute inset-x-1.5 -bottom-1.5 top-1.5 -rotate-[0.6deg] rounded-[1.6rem] bg-orange-50 shadow" aria-hidden />

          <article
            key={page}
            className={`${direction === "next" ? "page-in" : "page-in-reverse"} relative overflow-hidden rounded-[1.6rem] border-[6px] border-white bg-[#FFF9EC] shadow-[0_24px_60px_-15px_rgba(120,60,0,0.45)]`}
            aria-label={`Page ${page + 1}: ${story.title}`}
          >
            {/* ===== TOP HALF — illustration ===== */}
            <div className="relative h-60 overflow-hidden sm:h-72 md:h-[24rem]">
              <img
                src={story.image}
                alt={story.alt}
                className="zoom-soft h-full w-full object-cover"
                draggable={false}
              />
              {/* chapter ribbon */}
              <span className="font-display absolute left-4 top-4 rounded-full bg-white/90 px-4 py-1 text-sm font-bold text-amber-800 shadow-md backdrop-blur-sm">
                {story.chapter}
              </span>
              <span className="wiggle-hover absolute right-4 top-4 cursor-default rounded-full bg-amber-400 p-2 shadow-md" title="Woof!">
                <PawPrint className="h-5 w-5 text-amber-900" aria-hidden />
              </span>
              {/* scalloped divider into the paper */}
              <svg
                className="absolute -bottom-px left-0 w-full"
                viewBox="0 0 900 34"
                preserveAspectRatio="none"
                aria-hidden
              >
                <path
                  d="M0,34 L0,20 Q37.5,0 75,20 T150,20 T225,20 T300,20 T375,20 T450,20 T525,20 T600,20 T675,20 T750,20 T825,20 T900,20 L900,34 Z"
                  fill="#FFF9EC"
                />
              </svg>
            </div>

            {/* ===== BOTTOM HALF — story text ===== */}
            <div className="relative px-6 pb-8 pt-3 sm:px-10 md:px-12">
              {/* faint paper lines */}
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.35]"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(transparent, transparent 35px, #F3E3C0 35px, #F3E3C0 36px)",
                }}
                aria-hidden
              />
              <div className="relative">
                <div className="line-up flex flex-wrap items-center justify-between gap-3" style={{ animationDelay: "0.15s" }}>
                  <h2 className={`font-display text-3xl font-extrabold leading-tight sm:text-4xl ${story.accent}`}>
                    {story.title}
                  </h2>
                  {canSpeech && (
                    <button
                      onClick={readAloud}
                      className={`font-display inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-bold shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 ${
                        speaking
                          ? "bg-rose-500 text-white"
                          : "bg-amber-400 text-amber-950 hover:bg-amber-300"
                      }`}
                      aria-pressed={speaking}
                    >
                      {speaking ? (
                        <VolumeX className="sound-pulse h-4 w-4" aria-hidden />
                      ) : (
                        <Volume2 className="h-4 w-4" aria-hidden />
                      )}
                      {speaking ? "Stop reading" : "Read to me"}
                    </button>
                  )}
                </div>

                <div className="mt-3 space-y-4 text-[1.05rem] leading-9 text-stone-700 sm:text-lg sm:leading-9">
                  {story.paragraphs.map((p, i) => (
                    <p
                      key={i}
                      className={`line-up ${i === 0 ? `drop-cap ${story.accent}` : ""}`}
                      style={{ animationDelay: `${0.3 + i * 0.2}s` }}
                    >
                      <span className="text-stone-700">{p}</span>
                    </p>
                  ))}
                </div>

                {/* footer of the page */}
                <div className="line-up mt-6 flex items-center justify-between" style={{ animationDelay: "0.75s" }}>
                  <span className="flex items-center gap-1 text-amber-400" aria-hidden>
                    <PawPrint className="h-4 w-4 -rotate-12" />
                    <PawPrint className="h-4 w-4 rotate-6 translate-y-1" />
                    <PawPrint className="h-4 w-4 -rotate-6" />
                  </span>
                  <span className="font-display flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-lg font-extrabold text-amber-950 shadow-inner">
                    {page + 1}
                  </span>
                </div>
              </div>
            </div>
          </article>
        </main>

        {/* ---------- page controls ---------- */}
        <nav className="mt-6 mb-2 flex w-full items-center justify-between gap-3" aria-label="Book pages">
          <button
            onClick={() => goTo(page - 1)}
            disabled={page === 0}
            className="font-display inline-flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-2.5 text-sm font-bold text-amber-900 shadow-md transition-all hover:-translate-y-0.5 hover:bg-white hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-md sm:px-5 sm:text-base"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
            Back
          </button>

          <div className="flex items-center gap-2.5" role="tablist" aria-label="Choose a page">
            {PAGES.map((p, i) => (
              <button
                key={i}
                role="tab"
                aria-selected={i === page}
                aria-label={`Page ${i + 1}: ${p.title}`}
                title={p.title}
                onClick={() => goTo(i)}
                className={`font-display flex h-9 w-9 items-center justify-center rounded-full text-sm font-extrabold shadow transition-all hover:scale-110 ${
                  i === page
                    ? "scale-110 bg-amber-500 text-white ring-4 ring-white/70"
                    : "bg-white/80 text-amber-800 hover:bg-white"
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <button
            onClick={() => goTo(page + 1)}
            disabled={page === PAGES.length - 1}
            className="font-display inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:bg-amber-400 hover:shadow-lg active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-md sm:px-5 sm:text-base"
          >
            {page === PAGES.length - 1 ? "The End" : "Next page"}
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </nav>

        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-amber-900/60">
          <Sun className="h-3.5 w-3.5" aria-hidden />
          Tip: use the ← → arrow keys to turn the pages
        </p>
      </div>
    </div>
  );
}