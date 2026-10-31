export const WORDS = [
  { category: 'Animals', words: ['elephant', 'giraffe', 'penguin', 'butterfly', 'kangaroo', 'octopus', 'turtle', 'dolphin', 'hedgehog', 'flamingo', 'squirrel', 'crocodile'] },
  { category: 'Food', words: ['pizza', 'hamburger', 'watermelon', 'pancake', 'ice cream', 'sandwich', 'pineapple', 'donut', 'spaghetti', 'popcorn', 'taco', 'carrot'] },
  { category: 'Objects', words: ['umbrella', 'toothbrush', 'backpack', 'suitcase', 'binoculars', 'candle', 'lighthouse', 'telescope', 'headphones', 'key', 'clock', 'ladder'] },
  { category: 'Places', words: ['castle', 'volcano', 'airport', 'hospital', 'beach', 'library', 'school', 'bridge', 'mountain', 'spaceship', 'stadium', 'lighthouse'] },
  { category: 'Actions', words: ['dancing', 'sleeping', 'swimming', 'cooking', 'skateboarding', 'juggling', 'gardening', 'singing', 'climbing', 'painting', 'fishing', 'sneezing'] },
  { category: 'Nature', words: ['rainbow', 'lightning', 'snowflake', 'sunflower', 'waterfall', 'tornado', 'moon', 'cactus', 'forest', 'cloud', 'mushroom', 'starfish'] }
];

export const ALL_WORDS = [...new Set(WORDS.flatMap((group) => group.words))];
export const randomWords = (count, excluded = []) => {
  const blocked = new Set(excluded);
  const pool = ALL_WORDS.filter((word) => !blocked.has(word));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
};

export function normalizeGuess(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[.!?,;:]+$/g, '')
    .replace(/\s+/g, ' ');
}

export function maskWord(word, revealCount = 0) {
  let remaining = Math.max(0, revealCount);
  return [...word].map((character) => {
    if (!/[a-z0-9]/i.test(character)) return character;
    if (remaining > 0) { remaining -= 1; return character; }
    return '_';
  }).join(' ');
}
