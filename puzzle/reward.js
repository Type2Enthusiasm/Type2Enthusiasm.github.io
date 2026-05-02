/**
 * Reward content and timing are a small, stable seam in the puzzle.
 * The main puzzle module owns the reveal state machine; this module owns the
 * reward data, DOM shape, and animation timing constants consumed by it.
 */

/** @typedef {{ id: string; quote: string; author: string }} PuzzleQuoteRow */

/** @type {readonly PuzzleQuoteRow[]} */
export const PUZZLE_QUOTES = [
  { id: "aristotle-educated-mind", quote: "It is the mark of an educated mind to entertain a thought without accepting it.", author: "Aristotle" },
  { id: "michelangelo-aim", quote: "The greatest danger for most of us is not that our aim is too high and we miss it, but that it is too low and we reach it.", author: "Michelangelo" },
  { id: "friedman-optimists", quote: "Pessimists sound smart. Optimists make money.", author: "Nat Friedman" },
  { id: "marczewski-choose", quote: "You can't wait till everything is good to be happy. You have to choose.", author: "Jane Marczewski" },
  { id: "leguin-journey", quote: "It is good to have an end to journey toward; but it is the journey that matters, in the end.", author: "Ursula K. Le Guin" },
  { id: "greek-proverb-trees", quote: "A society grows great when old men plant trees whose shade they know they shall never sit in.", author: "Greek proverb" },
  { id: "nipsey-marathon", quote: "It's a marathon, not a sprint, but I still gotta win.", author: "Nipsey Hussle" },
  { id: "immortal-technique-purpose", quote: "The purpose of life is a life with a purpose. So I'd rather die for a cause than live a life that is worthless.", author: "Immortal Technique" }
];

/* Hold after unhide before the tile (card) starts to fade in. */
export const REWARD_TILE_APPEAR_DELAY_MS = 1650;
/* Beat 1: only the card chrome (section box): opacity + tiny Y — not the quote text. */
/* Beats 2–3: kicker / h2 / blockquote / hint, then list lines — each line’s own fade. */
export const REWARD_BEAT1_MS = 3000;
export const REWARD_ENTRANCE_MS = 3900;
export const REWARD_BEAT_GAP_MS = 360;
export const REWARD_BEAT2_STAGGER_MS = 210;
export const REWARD_BEAT3_STAGGER_MS = 150;
export const REWARD_REDUCE_MOTION_MS = 840;
/** Even fade (avoids “fast then done” from strong ease-out on long durations). */
export const REWARD_EASE = "cubic-bezier(0.45, 0, 0.55, 1)";

/**
 * Render the puzzle reward quotes into the existing quote stack element.
 *
 * @param {HTMLOListElement | HTMLElement | null} quoteStack
 * @param {readonly PuzzleQuoteRow[]} quotes
 * @returns {boolean} true when quote content was rendered
 */
export function renderRewardQuotes(quoteStack, quotes = PUZZLE_QUOTES) {
  if (!quoteStack || !quotes.length) {
    return false;
  }

  quoteStack.textContent = "";
  quoteStack.classList.add("puzzle-quote-stack--floaty");

  for (const row of quotes) {
    const item = document.createElement("li");
    const quote = document.createElement("blockquote");
    quote.className = "puzzle-quote-card";

    const quoteText = document.createElement("span");
    quoteText.className = "puzzle-quote-text";
    quoteText.textContent = `"${row.quote}"`;

    const author = document.createElement("cite");
    author.textContent = `- ${row.author}`;

    quote.append(quoteText, author);
    item.appendChild(quote);
    item.dataset.quoteId = row.id;
    item.tabIndex = 0;
    quoteStack.appendChild(item);
  }

  return true;
}
