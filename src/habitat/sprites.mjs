// Original pixel art for the Habitat, drawn in code (no image files).
// Characters are small hooded critters, 16x16, tinted with each AI's color.
// Palette keys: o outline, C cloak (AI color), D cloak shade, w highlight,
// s skin, e eye, b boots. '.' is transparent.

const HEAD_FRONT = [
  '................',
  '......oooo......',
  '....ooCCCCoo....',
  '...oCCCCCCwCo...',
  '...oCCCCCCCCo...',
  '..oCCssssssCCo..',
  '..oCsessssesCo..',
  '..oCssssssssCo..',
  '...oCssssssCo...',
];
const HEAD_BACK = [
  '................',
  '......oooo......',
  '....ooCCCCoo....',
  '...oCCCCCCwCo...',
  '...oCCCCCCCCo...',
  '..oCCCCCCCCCCo..',
  '..oCCCCCCCCCCo..',
  '..oCCCCCCCCCCo..',
  '...oCCCCCCCCo...',
];
const BODY = [
  '...oDCCCCCCDo...',
  '..oDCCCCCCCCDo..',
  '..oDCCCwwCCCDo..',
  '..oDCCCCCCCCDo..',
  '...oDDDDDDDDo...',
];
const LEGS = [
  ['....obo..obo....', '....ooo..ooo....'],
  ['....obo..oo.....', '....ooo.........'],
  ['....obo..obo....', '....ooo..ooo....'],
  ['.....oo..obo....', '.........ooo....'],
];
const HEAD_SIDE = [
  '................',
  '.....oooo.......',
  '....oCCCCoo.....',
  '...oCwCCCCCo....',
  '...oCCCCCCCo....',
  '...oCCCsssso....',
  '...oCCCssseso...',
  '...oCCCsssso....',
  '....oCCssso.....',
];
const BODY_SIDE = [
  '....oDCCCCo.....',
  '...oDCCCCCCo....',
  '...oDCCCwCCo....',
  '...oDCCCCCCo....',
  '....oDDDDDo.....',
];
const LEGS_SIDE = [
  ['.....obbo.......', '.....oooo.......'],
  ['....obo.obo.....', '....oo...oo.....'],
  ['.....obbo.......', '.....oooo.......'],
  ['.....oobo.......', '......ooo.......'],
];

// SPRITES[dir][frame] = 16 rows of 16 chars. 'left' is drawn mirrored from 'right'.
export const SPRITES = {
  down: LEGS.map((l) => [...HEAD_FRONT, ...BODY, ...l]),
  up: LEGS.map((l) => [...HEAD_BACK, ...BODY, ...l]),
  right: LEGS_SIDE.map((l) => [...HEAD_SIDE, ...BODY_SIDE, ...l]),
};
// Sleeping: eyes closed.
export const SLEEP = [...HEAD_FRONT.slice(0, 6), '..oCsossssosCo..', ...HEAD_FRONT.slice(7)];

export const ICONS = {
  star: ['...o...', '..oyo..', 'ooyyyoo', '.oyyyo.', '.oyoyo.', 'oo...oo'],
  bubble: ['.ooooooo.', 'owwwwwwwo', 'owkwkwkwo', 'owwwwwwwo', '.oowoooo.', '...o.....'],
  magnifier: ['.ooo...', 'owwwo..', 'owwwo..', 'owwwo..', '.oooo..', '....oo.', '.....oo'],
  lock: ['..ooo..', '.o...o.', '.o...o.', 'ooooooo', 'oyyyyyo', 'oyyoyyo', 'oyyyyyo', 'ooooooo'],
  ask: ['.ooo.', 'o...o', '...o.', '..o..', '.....', '..o..'],
};

// The pet: a round little ember-fox blob of our own design (12x10).
// o outline, F fur, f fur shade, c cream, e eye, n nose, t tail tip.
export const PET = {
  sit: [
    '..o......o..',
    '.oFo....oFo.',
    '.oFFooooFFo.',
    'oFFFFFFFFFFo',
    'oFeFFFFFFeFo',
    'oFFccnnccFFo',
    'oFcccccccFFo',
    '.oFccccccFoo',
    '.oFFffffFFoto',
    '..oooooooooo',
  ].map((r) => r.padEnd(12, '.').slice(0, 12)),
  walk: [
    [
      '.......o..o.',
      '......oFooFo',
      '.ooo..oFFFFo',
      'otFFooFFFFeo',
      '.oFFFFFFFFno',
      '.oFFFFFFccco',
      '.offFFFFccco',
      '..offffffoo.',
      '..oo.oo.oo..',
      '............',
    ],
    [
      '.......o..o.',
      '......oFooFo',
      'ooo...oFFFFo',
      'otFFooFFFFeo',
      '.oFFFFFFFFno',
      '.oFFFFFFccco',
      '.offFFFFccco',
      '..offffffoo.',
      '...oo.oo.oo.',
      '............',
    ],
  ],
  nap: [
    '............',
    '............',
    '....oooooo..',
    '..ooFFFFFFo.',
    '.oFFFFFFFFFo',
    'oFoFFFFFoFFo',
    'oFFccccFFFFo',
    'otFFccFFFFFo',
    '.ottffffffo.',
    '..oooooooo..',
  ],
};

export const ICONS2 = {
  paper: ['ooooo.', 'owwwoo', 'okkkwo', 'owwwwo', 'okkkwo', 'oooooo'],
  cloud: ['..ooo...', '.owwwoo.', 'owwwwwwo', 'owwwwwwo', '.oooooo.'],
  sparkle: ['...y...', '...y...', '.yyyyy.', '...y...', '...y...'],
  dots: ['ooooooooo', 'owwwwwwwo', 'owkwkwkwo', 'owwwwwwwo', '.oowoooo.'],
  stamp: ['.ooooo.', 'orrrrro', 'orwrwro', 'orrrrro', 'orwwwro', 'orrrrro', '.ooooo.'],
  trophy: ['ooooooo', 'oyyyyyo', '.oyyyo.', '..oyo..', '..oyo..', '.ooooo.'],
  medal: ['o...o', '.o.o.', '.ooo.', 'oyyyo', 'oyyyo', '.ooo.'],
  heart: ['.oo.oo.', 'orrorro', 'orrrrro', '.orrro.', '..oro..', '...o...'],
  smile: ['.ooooo.', 'oyoyoyo', 'oyyyyyo', 'oyoooyo', '.ooooo.'],
  drop: ['.b.', 'bbb', '.b.'],
};

// 3x5 pixel font for name plates and task ids (A-Z, 0-9, - . space).
const G = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', '-': '000000111000000', '.': '000000000000010', ' ': '000000000000000',
};
export const FONT = G;
export const glyph = (ch) => G[String(ch).toUpperCase()] || G[' '];
export const textWidth = (s) => Math.max(0, String(s).length * 4 - 1);
