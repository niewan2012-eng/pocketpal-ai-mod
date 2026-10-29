/**
 * Sentence-level streaming for engines that take pre-phonemized input.
 *
 * The library's `Speech.createSpeechStream` streams *text* and phonemizes each
 * flush internally with the English dict G2P, so it cannot be used for Chinese.
 * This handle keeps the same contract (append / finalize / cancel) but
 * phonemizes each sentence itself and plays them in order through
 * `Speech.speak({ phonemes })`.
 *
 * Trade-off, deliberately taken: playback starts per sentence and prosody does
 * not span sentences, matching what the library's clause/sentence flush does
 * anyway.
 */

import {Platform} from 'react-native';

import Speech from '@pocketpalai/react-native-speech';

import {ttsRuntime} from '../../../runtime';
import type {Engine, StreamOptions, StreamingHandle} from '../../../types';
import {hasChinese, zhTextToPhonemes} from './zhPhonemizer';

/** Split after CJK/Latin sentence enders, keeping the punctuation. */
const SENTENCE_END = /([^。！？；!?;\n]*[。！？；!?;\n]+)/g;

export function splitSentences(buffer: string): {
  complete: string[];
  rest: string;
} {
  const complete: string[] = [];
  let consumed = 0;
  for (const match of buffer.matchAll(SENTENCE_END)) {
    const text = match[0].trim();
    if (text) {
      complete.push(text);
    }
    consumed = (match.index ?? 0) + match[0].length;
  }
  return {complete, rest: buffer.slice(consumed)};
}

export function createPhonemeStreamingHandle(
  engine: Engine,
  voiceId: string,
  waitFor?: Promise<void>,
  streamOpts?: StreamOptions,
): StreamingHandle {
  let buffer = '';
  let dead = false;
  let exhausted = false;
  let chain: Promise<void> = Promise.resolve();
  const onProgress = streamOpts?.onProgress;
  let emittedChars = 0;

  const speak = (text: string) => {
    const phonemes = zhTextToPhonemes(text);
    if (!phonemes) {
      return;
    }
    const start = emittedChars;
    const end = start + text.length;
    emittedChars = end;
    chain = chain
      .then(() => {
        if (dead) {
          return;
        }
        onProgress?.({charStart: start, charEnd: end} as never);
        return Speech.speak({phonemes}, voiceId);
      })
      .catch(err => {
        console.warn(`[${engine.id}] zh sentence synthesis failed:`, err);
      });
  };

  const ready = (waitFor ?? Promise.resolve())
    .catch(() => {})
    .then(() => {
      if (dead) {
        return;
      }
      return ttsRuntime.acquire(engine, async () => {});
    })
    .catch(err => {
      console.warn(`[${engine.id}] phoneme stream acquire failed:`, err);
    });

  const flushComplete = () => {
    const {complete, rest} = splitSentences(buffer);
    buffer = rest;
    for (const sentence of complete) {
      speak(sentence);
    }
  };

  return {
    appendText(chunk: string) {
      if (dead || exhausted) {
        return;
      }
      buffer += chunk;
      // Only Chinese needs this path; plain text still goes through it so a
      // mixed reply keeps one prosody order.
      if (hasChinese(buffer)) {
        flushComplete();
      }
    },
    async finalize() {
      if (dead) {
        return;
      }
      exhausted = true;
      const rest = buffer.trim();
      buffer = '';
      if (rest) {
        speak(rest);
      }
      await ready;
      await chain;
    },
    async cancel() {
      if (dead) {
        return;
      }
      dead = true;
      buffer = '';
      await Speech.stop();
    },
  };
}

/** Streaming is only for Android/iOS neural engines, kept explicit for clarity. */
export const phonemeStreamingSupported =
  Platform.OS === 'android' || Platform.OS === 'ios';
