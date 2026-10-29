/**
 * Pinyin -> IPA for Kokoro's Mandarin voices.
 *
 * A TypeScript port of misaki's `pinyin_to_ipa` (misaki/transcription.py, MIT,
 * adapted there from stefantaubert/pinyin-to-ipa), i.e. the exact G2P the zh
 * voice embeddings were trained with. The tables live in `pinyinIpaTables.ts`;
 * this file is only the splitting and tone logic.
 *
 * Output matches misaki's post-`retone` form, which is what the Kokoro
 * tokenizer knows: tone letters are replaced by arrows (˥→ →, ˧˥ ↗, ˧˩˧ ↓,
 * ˥˩ ↘) and the syllabic-consonant notations collapse to ɨ.
 */

import {
  FINAL_MAPPING,
  FINAL_MAPPING_AFTER_Z_C_S,
  FINAL_MAPPING_AFTER_ZH_CH_SH_R,
  INITIAL_MAPPING,
  INTERJECTION_MAPPINGS,
  SYLLABIC_CONSONANT_MAPPINGS,
  TONE_MAPPING,
} from './pinyinIpaTables';

/** Longest-first so `zh` wins over `z`, `ch` over `c`, `sh` over `s`. */
const INITIALS = [
  'zh',
  'ch',
  'sh',
  'b',
  'p',
  'm',
  'f',
  'd',
  't',
  'n',
  'l',
  'g',
  'k',
  'h',
  'j',
  'q',
  'x',
  'r',
  'z',
  'c',
  's',
];

/**
 * pypinyin's strict reading of the zero-initial spellings: `y`/`w` are not
 * initials, they are part of the final's spelling.
 */
const ZERO_INITIAL_FINALS: Record<string, string> = {
  yi: 'i',
  ya: 'ia',
  ye: 'ie',
  yao: 'iao',
  you: 'iou',
  yan: 'ian',
  yin: 'in',
  yang: 'iang',
  ying: 'ing',
  yong: 'iong',
  yu: 'ü',
  yue: 'üe',
  yuan: 'üan',
  yun: 'ün',
  wu: 'u',
  wa: 'ua',
  wo: 'uo',
  wai: 'uai',
  wei: 'uei',
  wan: 'uan',
  wen: 'uen',
  wang: 'uang',
  weng: 'ueng',
};

/** pypinyin expands the abbreviated finals before lookup. */
const ABBREVIATED_FINALS: Record<string, string> = {
  iu: 'iou',
  ui: 'uei',
  un: 'uen',
};

export interface PinyinParts {
  initial: string | null;
  final: string | null;
  tone: number;
}

const TONE_DIGITS = /^([a-zü]+)([0-5])$/i;

/**
 * Split `ni3` / `lv4` / `yue4` into pypinyin's strict initial, final and tone.
 *
 * Returns null finals for syllables the tables cannot express; callers skip
 * those rather than inventing phonemes.
 */
export function splitPinyin(pinyinWithTone: string): PinyinParts | null {
  const m = TONE_DIGITS.exec(pinyinWithTone.trim().toLowerCase());
  if (!m) {
    return null;
  }
  const syllable = m[1]!;
  // pinyin-pro writes ü as ü and uses 0 for the neutral tone; misaki's tables
  // index 5 for it.
  const rawTone = Number(m[2]);
  const tone = rawTone === 0 ? 5 : rawTone;

  if (syllable in ZERO_INITIAL_FINALS) {
    return {initial: null, final: ZERO_INITIAL_FINALS[syllable]!, tone};
  }

  if (syllable in SYLLABIC_CONSONANT_MAPPINGS) {
    return {initial: null, final: syllable, tone};
  }

  if (syllable in INTERJECTION_MAPPINGS) {
    return {initial: null, final: syllable, tone};
  }

  const initial =
    INITIALS.find(candidate => syllable.startsWith(candidate)) ?? null;
  const rest = initial ? syllable.slice(initial.length) : syllable;
  if (!rest) {
    return null;
  }

  // j/q/x are written with u where the phoneme is ü.
  let final = rest;
  if (initial && ['j', 'q', 'x'].includes(initial) && final.startsWith('u')) {
    final = 'ü' + final.slice(1);
  }
  final = ABBREVIATED_FINALS[final] ?? final;

  return {initial, final, tone};
}

const TONE_LETTERS = TONE_MAPPING;

/**
 * Replace Chao tone letters with the arrows Kokoro was trained on, and fold the
 * syllabic-consonant notations into ɨ (misaki's `retone`).
 */
export function retone(ipa: string): string {
  return ipa
    .replace(/\u02e7\u02e9\u02e7/g, '\u2193') // ˧˩˧ → ↓ (third tone)
    .replace(/\u02e7\u02e5/g, '\u2197') //˧˥ → ↗ (second tone)
    .replace(/\u02e5\u02e9/g, '\u2198') // ˥˩ → ↘ (fourth tone)
    .replace(/\u02e5/g, '\u2192') // ˥ → → (first tone)
    .replace(/\u027b\u0329/g, '\u0268') // ɻ + combining vertical line → ɨ
    .replace(/\u0279\u0329/g, '\u0268') // ɹ + combining vertical line → ɨ
    .replace(/\u0329/g, '') // any leftover combining vertical line
    .replace(/\u032f/g, ''); // misaki's own final strip (non-syllabic mark)
}

/** First variant of a pinyin initial/final, tone applied. */
function applyTone(pieces: string[], tone: number): string {
  const toneLetter = TONE_LETTERS[tone] ?? '';
  return pieces.map(piece => piece.replace(/0/g, toneLetter)).join('');
}

/**
 * Pinyin syllable (tone digit included) to IPA, or null when the tables have no
 * entry for it (rare spellings, `ê`, dialect-only syllables).
 */
export function pinyinToIpa(pinyinWithTone: string): string | null {
  const parts = splitPinyin(pinyinWithTone);
  if (!parts) {
    return null;
  }

  // Whole-syllable tables first: syllabic consonants (zhi, chi, si, er, m, n,
  // ng, hm, hng) and interjections (o, ê, io) are spelled as one unit. They are
  // keyed by the *whole* syllable, not the final: "o" is an interjection but
  // "bo" is an ordinary b- syllable.
  const syllable = parts.initial ? parts.initial + parts.final : parts.final;
  const whole =
    (syllable && SYLLABIC_CONSONANT_MAPPINGS[syllable]) ||
    (syllable && INTERJECTION_MAPPINGS[syllable]);
  if (whole) {
    return retone(applyTone(whole[0]!, parts.tone));
  }

  const final = parts.final!;
  let initialPieces: string[] = [];
  if (parts.initial) {
    const mapped = INITIAL_MAPPING[parts.initial];
    if (!mapped) {
      return null;
    }
    initialPieces = mapped[0]!;
  }

  const finalTable =
    parts.initial &&
    ['zh', 'ch', 'sh', 'r'].includes(parts.initial) &&
    FINAL_MAPPING_AFTER_ZH_CH_SH_R[final]
      ? FINAL_MAPPING_AFTER_ZH_CH_SH_R
      : parts.initial &&
          ['z', 'c', 's'].includes(parts.initial) &&
          FINAL_MAPPING_AFTER_Z_C_S[final]
        ? FINAL_MAPPING_AFTER_Z_C_S
        : FINAL_MAPPING;

  const finalPieces = finalTable[final]?.[0];
  if (!finalPieces) {
    return null;
  }

  return retone(
    applyTone(initialPieces, parts.tone) + applyTone(finalPieces, parts.tone),
  );
}
