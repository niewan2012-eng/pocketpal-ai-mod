/**
 * Mandarin G2P for Kokoro: the pinyin->IPA port must stay identical to the G2P
 * the zh voice embeddings were trained with (misaki), and the text layer must
 * produce phonemes the Kokoro tokenizer actually contains.
 */

import {pinyinToIpa, splitPinyin} from '../pinyinToIpa';
import {
  hanziToPhonemes,
  numbersToHanzi,
  zhTextToPhonemes,
} from '../zhPhonemizer';
import {EXPECTED_SYLLABLES} from './expectedSyllables';

describe('pinyinToIpa', () => {
  it.each(Object.entries(EXPECTED_SYLLABLES))(
    'matches misaki for %s',
    (pinyin, expected) => {
      expect(pinyinToIpa(pinyin)).toBe(expected);
    },
  );

  it('returns null for syllables the tables cannot express', () => {
    expect(pinyinToIpa('wao1')).toBeNull();
    expect(pinyinToIpa('xyz')).toBeNull();
  });

  it('splits pypinyin-style initials and finals', () => {
    // zhi/chi/shi/zi/ci/si are a real initial plus the apical vowel "i", which
    // FINAL_MAPPING_AFTER_ZH_CH_SH_R / _AFTER_Z_C_S map to ɨ — not a
    // whole-syllable table entry.
    expect(splitPinyin('zhi1')).toEqual({initial: 'zh', final: 'i', tone: 1});
    expect(splitPinyin('si1')).toEqual({initial: 's', final: 'i', tone: 1});
    expect(splitPinyin('zhang1')).toEqual({
      initial: 'zh',
      final: 'ang',
      tone: 1,
    });
    expect(splitPinyin('yue4')).toEqual({initial: null, final: 'üe', tone: 4});
    expect(splitPinyin('ju2')).toEqual({initial: 'j', final: 'ü', tone: 2});
    expect(splitPinyin('liu2')).toEqual({initial: 'l', final: 'iou', tone: 2});
    expect(splitPinyin('gun3')).toEqual({initial: 'g', final: 'uen', tone: 3});
  });

  it('treats pinyin-pro tone 0 as the neutral tone', () => {
    expect(pinyinToIpa('ma0')).toBe(pinyinToIpa('ma5'));
  });
});

describe('zhTextToPhonemes', () => {
  it('phonemizes a sentence to Kokoro arrows', () => {
    expect(zhTextToPhonemes('你好，世界。')).toBe('ni↓ xau↓ , ʂɨ↘ ʨje↘ .');
  });

  it('leaves no Chao tone letters behind', () => {
    const phonemes = zhTextToPhonemes('今天天气很好，我们出去散步吧！');
    expect(phonemes).not.toMatch(/[\u02e5\u02e7\u02e9]/);
    // misaki's own final strip of the non-syllabic mark
    expect(phonemes).not.toMatch(/[\u0329\u032f]/);
  });

  it('writes numbers out before phonemizing', () => {
    expect(numbersToHanzi('2024年')).toBe('二零二四年');
    expect(numbersToHanzi('18岁')).toBe('十八岁');
    expect(numbersToHanzi('36.5度')).toBe('三十六点五度');
    expect(zhTextToPhonemes('我有3个苹果。')).toContain('sa→n');
  });

  it('keeps ASCII words and drops nothing silently', () => {
    const phonemes = zhTextToPhonemes('用 AI 写代码。');
    expect(phonemes).toContain('AI');
    expect(phonemes.split(/\s+/).length).toBeGreaterThan(3);
  });

  it('phonemizes each hanzi segment and leaves punctuation as tokens', () => {
    expect(hanziToPhonemes('你好')).toBe('ni↓ xau↓');
    expect(zhTextToPhonemes('好！')).toBe('xau↓ !');
  });
});
