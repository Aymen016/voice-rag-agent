'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API is not in TypeScript's DOM lib everywhere; keep it loose.
type AnyRecognition = any;

interface Options {
  lang?: string;
  /** Stop after this much silence once the user has started speaking. */
  silenceMs?: number;
  /** Give up if nothing is said at all within this time. */
  noSpeechMs?: number;
}

const ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow it in the browser address bar and try again.',
  'service-not-allowed': 'Speech recognition is blocked in this browser context.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection in Chrome.',
};

/**
 * Browser speech-to-text (Chrome / Edge / Safari).
 * Uses continuous mode plus our own silence timer, which copes better with
 * longer utterances (like spelling an email) than the default single-shot mode.
 */
export function useSpeechRecognition({ lang = 'en-US', silenceMs = 1500, noSpeechMs = 8000 }: Options = {}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<AnyRecognition | null>(null);
  const finalRef = useRef('');
  const interimRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDoneRef = useRef<((text: string) => void) | null>(null);

  useEffect(() => {
    const w = window as any;
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const stop = useCallback(() => {
    clearTimer();
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
  }, []);

  /** Abort without delivering a transcript. */
  const cancel = useCallback(() => {
    clearTimer();
    onDoneRef.current = null;
    try {
      recRef.current?.abort();
    } catch {
      /* ignore */
    }
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(
    (onDone: (text: string) => void) => {
      const w = window as any;
      const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (!Ctor) {
        setError('Speech recognition is not supported in this browser. Use Chrome or Edge, or type below.');
        return;
      }
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }

      const rec: AnyRecognition = new Ctor();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      finalRef.current = '';
      interimRef.current = '';
      onDoneRef.current = onDone;
      setInterim('');
      setError(null);

      const arm = (ms: number) => {
        clearTimer();
        timerRef.current = setTimeout(() => {
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
        }, ms);
      };

      rec.onstart = () => {
        setListening(true);
        arm(noSpeechMs);
      };
      rec.onresult = (e: any) => {
        let live = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalRef.current += `${r[0].transcript} `;
          else live += r[0].transcript;
        }
        interimRef.current = live;
        setInterim(`${finalRef.current}${live}`.trim());
        arm(silenceMs);
      };
      rec.onerror = (e: any) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        setError(ERRORS[e.error] ?? `Speech recognition error: ${e.error}`);
      };
      rec.onend = () => {
        clearTimer();
        setListening(false);
        const text = `${finalRef.current} ${interimRef.current}`.replace(/\s+/g, ' ').trim();
        setInterim('');
        const cb = onDoneRef.current;
        onDoneRef.current = null;
        cb?.(text);
      };

      recRef.current = rec;
      try {
        rec.start();
      } catch (err: any) {
        setError(err?.message ?? 'Could not start the microphone');
      }
    },
    [lang, silenceMs, noSpeechMs],
  );

  return { supported, listening, interim, error, start, stop, cancel, setError };
}
