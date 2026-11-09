'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** Split into sentence-sized pieces. Chrome stops long utterances after ~15 s. */
function chunk(text: string, max = 180): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const PREFERRED = [/Google US English/i, /Microsoft (Aria|Jenny|Guy).*Online/i, /Samantha/i, /Natural/i];

/** Browser text-to-speech with a cancellable sentence queue. */
export function useSpeechSynthesis() {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const tokenRef = useRef(0);

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);
    const pick = () => {
      const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
      voiceRef.current =
        PREFERRED.map((re) => voices.find((v) => re.test(v.name))).find(Boolean) ??
        voices.find((v) => v.lang === 'en-US') ??
        voices[0] ??
        null;
    };
    pick();
    window.speechSynthesis.addEventListener('voiceschanged', pick);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', pick);
      window.speechSynthesis.cancel();
    };
  }, []);

  const cancel = useCallback(() => {
    tokenRef.current++;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string, onEnd?: () => void) => {
    if (!('speechSynthesis' in window) || !text.trim()) {
      onEnd?.();
      return;
    }
    const token = ++tokenRef.current;
    window.speechSynthesis.cancel();
    const parts = chunk(text);
    let i = 0;
    setSpeaking(true);

    const next = () => {
      if (token !== tokenRef.current) return; // cancelled or superseded
      if (i >= parts.length) {
        setSpeaking(false);
        onEnd?.();
        return;
      }
      const u = new SpeechSynthesisUtterance(parts[i++]);
      if (voiceRef.current) u.voice = voiceRef.current;
      u.rate = 1.04;
      u.onend = next;
      u.onerror = next;
      window.speechSynthesis.speak(u);
    };
    next();
  }, []);

  return { supported, speaking, speak, cancel };
}
