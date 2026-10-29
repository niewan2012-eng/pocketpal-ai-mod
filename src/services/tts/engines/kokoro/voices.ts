import type {Voice} from '../../types';

/**
 * Kokoro 82M v1.0 voice catalog (22 voices).
 *
 * IDs follow the `<lang><gender>_<name>` convention used by the upstream
 * repo: `a` = American English, `b` = British English, `e` = Spanish,
 * `f` = French, `h` = Hindi, `i` = Italian, `j` = Japanese, `p` =
 * Brazilian Portuguese, `z` = Mandarin Chinese. `f` = female, `m` = male.
 *
 * Mandarin voices are included: they need no extra model files (same 82M
 * model, same .bin format) but do need pre-phonemized input, because the
 * library's dict G2P is English-only. `zhToPhonemes()` supplies misaki's
 * pinyin->IPA, the G2P these embeddings were trained with.
 */
export const KOKORO_VOICES: Voice[] = [
  // American English — female
  {
    id: 'af_heart',
    name: 'Heart',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_bella',
    name: 'Bella',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_nicole',
    name: 'Nicole',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_sarah',
    name: 'Sarah',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_sky',
    name: 'Sky',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_aoede',
    name: 'Aoede',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_jessica',
    name: 'Jessica',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_kore',
    name: 'Kore',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  {
    id: 'af_river',
    name: 'River',
    engine: 'kokoro',
    language: 'en',
    gender: 'f',
  },
  // American English — male
  {
    id: 'am_adam',
    name: 'Adam',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_echo',
    name: 'Echo',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_eric',
    name: 'Eric',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_fenrir',
    name: 'Fenrir',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_liam',
    name: 'Liam',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_michael',
    name: 'Michael',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_onyx',
    name: 'Onyx',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  {
    id: 'am_santa',
    name: 'Santa',
    engine: 'kokoro',
    language: 'en',
    gender: 'm',
  },
  // British English — female
  {
    id: 'bf_alice',
    name: 'Alice',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'f',
  },
  {
    id: 'bf_emma',
    name: 'Emma',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'f',
  },
  {
    id: 'bf_lily',
    name: 'Lily',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'f',
  },
  // British English — male
  {
    id: 'bm_george',
    name: 'George',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'm',
  },
  {
    id: 'bm_lewis',
    name: 'Lewis',
    engine: 'kokoro',
    language: 'en-GB',
    gender: 'm',
  },

  // Mandarin Chinese — female
  {
    id: 'zf_xiaobei',
    name: 'Xiaobei',
    engine: 'kokoro',
    language: 'zh',
    gender: 'f',
  },
  {
    id: 'zf_xiaoni',
    name: 'Xiaoni',
    engine: 'kokoro',
    language: 'zh',
    gender: 'f',
  },
  {
    id: 'zf_xiaoxiao',
    name: 'Xiaoxiao',
    engine: 'kokoro',
    language: 'zh',
    gender: 'f',
  },
  {
    id: 'zf_xiaoyi',
    name: 'Xiaoyi',
    engine: 'kokoro',
    language: 'zh',
    gender: 'f',
  },
  // Mandarin Chinese — male
  {
    id: 'zm_yunjian',
    name: 'Yunjian',
    engine: 'kokoro',
    language: 'zh',
    gender: 'm',
  },
  {
    id: 'zm_yunxi',
    name: 'Yunxi',
    engine: 'kokoro',
    language: 'zh',
    gender: 'm',
  },
  {
    id: 'zm_yunxia',
    name: 'Yunxia',
    engine: 'kokoro',
    language: 'zh',
    gender: 'm',
  },
  {
    id: 'zm_yunyang',
    name: 'Yunyang',
    engine: 'kokoro',
    language: 'zh',
    gender: 'm',
  },
];
