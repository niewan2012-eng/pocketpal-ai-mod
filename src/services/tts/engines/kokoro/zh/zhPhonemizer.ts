/**
 * Mandarin text -> IPA phonemes for Kokoro's zh voices.
 *
 * Mirrors misaki's legacy Chinese pipeline (the one the `zf_*`/`zm_*` voice
 * embeddings were trained with):
 *
 *   1. numbers are written out in Chinese          (cn2an `an2cn`)
 *   2. CJK punctuation becomes ASCII               (`map_punctuation`)
 *   3. hanzi run -> pinyin -> IPA                  (`word2ipa` + `pinyin_to_ipa`)
 *
 * Deviation from misaki: it segments a hanzi run with jieba and concatenates
 * the syllables inside each word. We have no jieba; syllables are separated by
 * spaces and 多音字 selection comes from pinyin-pro's own phrase dictionary.
 * That is a prosody difference, not a phoneme difference.
 *
 * The result is fed to the engine as `{ phonemes }`, which bypasses the
 * library's English-only dict G2P.
 */

import {pinyin} from 'pinyin-pro';

import {pinyinToIpa} from './pinyinToIpa';

/** CJK ideographs (incl. ext A and compatibility) plus the CJK punctuation we
 * fold to ASCII below. */
const CJK_RUN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/g;
const HAS_CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/** misaki's `map_punctuation`, restricted to what Kokoro's tokenizer knows. */
const PUNCTUATION_MAP: Array<[RegExp, string]> = [
  [/[、，]/g, ', '],
  [/[。．]/g, '. '],
  [/！/g, '! '],
  [/：/g, ': '],
  [/；/g, '; '],
  [/？/g, '? '],
  [/«|《|「|【/g, ' "'],
  [/»|》|」|】/g, '" '],
  [/（/g, ' ('],
  [/）/g, ') '],
  [/…/g, '… '],
  [/\s+/g, ' '],
];

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const UNITS = ['', '十', '百', '千'];
const BIG_UNITS = ['', '万', '亿', '万亿'];

/** Digit-by-digit reading, used for years and decimals. */
function digitByDigit(digits: string): string {
  return [...digits].map(d => DIGITS[Number(d)] ?? '').join('');
}

/** Cardinal reading of an integer, e.g. 2024 -> 二千零二十四. */
function cardinal(value: number): string {
  if (value === 0) {
    return DIGITS[0]!;
  }
  const groups: string[] = [];
  let rest = value;
  let groupIndex = 0;
  while (rest > 0) {
    const group = rest % 10000;
    rest = Math.floor(rest / 10000);
    if (group > 0) {
      let text = '';
      let remaining = group;
      for (let unit = 3; unit >= 0; unit--) {
        const digit = Math.floor(remaining / 10 ** unit);
        remaining %= 10 ** unit;
        if (digit > 0) {
          // 一十 -> 十 for the tens place of the first group.
          const spoken =
            unit === 1 && digit === 1 && text === '' && groupIndex === 0
              ? ''
              : DIGITS[digit]!;
          text += spoken + UNITS[unit];
        } else if (text !== '' && remaining > 0) {
          text += DIGITS[0];
        }
      }
      groups.unshift(text + BIG_UNITS[groupIndex]);
    } else if (groups.length > 0) {
      groups.unshift(DIGITS[0]);
    }
    groupIndex++;
  }
  return groups.join('').replace(/零+/g, '零').replace(/零$/, '');
}

/**
 * Write digit runs out in Chinese.
 *
 * Years (4 digits before 年) read digit by digit, as they are spoken; anything
 * else is a cardinal, with decimals after 点.
 */
export function numbersToHanzi(text: string): string {
  return text.replace(
    /(\d+(?:\.\d+)?)(\s*)(年)?/g,
    (match, raw: string, _sp, year) => {
      const [intPart, fracPart] = raw.split('.') as [
        string,
        string | undefined,
      ];
      if (year) {
        return (
          (intPart.length === 4
            ? digitByDigit(intPart)
            : cardinal(Number(intPart))) + '年'
        );
      }
      if (fracPart !== undefined) {
        return cardinal(Number(intPart)) + '点' + digitByDigit(fracPart);
      }
      const value = Number(intPart);
      if (!Number.isFinite(value) || value > 1e15) {
        return match;
      }
      return cardinal(value);
    },
  );
}

/** True when the text has hanzi and should go through this pipeline. */
export function hasChinese(text: string): boolean {
  return HAS_CJK.test(text);
}

/**
 * Hanzi run to space-separated IPA. Syllables the tables cannot express are
 * dropped rather than guessed.
 */
export function hanziToPhonemes(run: string): string {
  const syllables = pinyin(run, {toneType: 'num', type: 'array', v: false});
  const out: string[] = [];
  for (const syllable of syllables) {
    const ipa = pinyinToIpa(String(syllable));
    if (ipa) {
      out.push(ipa);
    }
  }
  return out.join(' ');
}

/**
 * Full pipeline: Chinese text (with ASCII words, digits and punctuation) to the
 * IPA string Kokoro's zh voices expect.
 */
export function zhTextToPhonemes(text: string): string {
  let prepared = numbersToHanzi(text);
  for (const [pattern, replacement] of PUNCTUATION_MAP) {
    prepared = prepared.replace(pattern, replacement);
  }

  const parts: string[] = [];
  let lastIndex = 0;
  for (const match of prepared.matchAll(CJK_RUN)) {
    const index = match.index ?? 0;
    const between = prepared.slice(lastIndex, index).trim();
    if (between) {
      parts.push(between);
    }
    const phonemes = hanziToPhonemes(match[0]);
    if (phonemes) {
      parts.push(phonemes);
    }
    lastIndex = index + match[0].length;
  }
  const tail = prepared.slice(lastIndex).trim();
  if (tail) {
    parts.push(tail);
  }

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
