'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { AgentStatus, Turn } from '@/lib/types';
import { useSpeechRecognition } from './useSpeechRecognition';
import { useSpeechSynthesis } from './useSpeechSynthesis';

const SESSION_KEY = 'nova.sessionId';

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Orchestrates the voice loop:
 *   listen (STT) -> send transcript to the agent -> show turn -> speak (TTS)
 *   -> optionally listen again (hands-free).
 * Clicking the mic while the agent is speaking interrupts it (barge-in).
 */
export function useVoiceAgent() {
  const stt = useSpeechRecognition();
  const tts = useSpeechSynthesis();

  const [sessionId, setSessionId] = useState<string>('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [processing, setProcessing] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [handsFree, setHandsFree] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef('');
  const autoSpeakRef = useRef(autoSpeak);
  const handsFreeRef = useRef(handsFree);
  const listenRef = useRef<() => void>(() => {});
  const busyRef = useRef(false);

  useEffect(() => {
    autoSpeakRef.current = autoSpeak;
  }, [autoSpeak]);
  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);

  // Restore the session (and its transcript) after a page reload.
  useEffect(() => {
    let id = '';
    try {
      id = localStorage.getItem(SESSION_KEY) ?? '';
    } catch {
      /* storage unavailable */
    }
    if (!id) {
      id = newId();
      try {
        localStorage.setItem(SESSION_KEY, id);
      } catch {
        /* ignore */
      }
    }
    sessionRef.current = id;
    setSessionId(id);

    // If the page was reloaded while Nova was answering, the backend finishes
    // the turn anyway. Show "working" and poll until the answer lands.
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) =>
      api
        .session(id)
        .then((s) => {
          if (cancelled) return;
          setTurns(s.turns);
          if (s.busy && attempt < 60) {
            busyRef.current = true;
            setProcessing(true);
            timer = setTimeout(() => load(attempt + 1), 2000);
          } else {
            busyRef.current = false;
            setProcessing(false);
          }
        })
        .catch(() => {
          /* new or expired session */
          busyRef.current = false;
          setProcessing(false);
        });
    load(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      tts.cancel();
      setError(null);
      const userTurn: Turn = { id: newId(), role: 'user', text, at: new Date().toISOString() };
      setTurns((t) => [...t, userTurn]);
      setProcessing(true);

      let speakText = '';
      try {
        const res = await api.chat(sessionRef.current, text);
        if (res.sessionId !== sessionRef.current) {
          sessionRef.current = res.sessionId;
          setSessionId(res.sessionId);
        }
        setTurns((t) => [...t, res.turn]);
        speakText = res.speech;
      } catch (err: any) {
        const message = err?.message ?? 'Something went wrong';
        setError(message);
        setTurns((t) => [...t, { id: newId(), role: 'assistant', text: message, at: new Date().toISOString(), error: true }]);
        speakText = 'Sorry, something went wrong on my side.';
      } finally {
        setProcessing(false);
        busyRef.current = false;
      }

      const afterSpeech = () => {
        if (handsFreeRef.current) listenRef.current();
      };
      if (autoSpeakRef.current) tts.speak(speakText, afterSpeech);
      else afterSpeech();
    },
    [tts],
  );

  const listen = useCallback(() => {
    if (busyRef.current) return;
    tts.cancel(); // barge-in
    setError(null);
    stt.start((text) => {
      if (text) void send(text);
      // Silence in hands-free mode ends the loop instead of spinning forever.
      else if (handsFreeRef.current) setHandsFree(false);
    });
  }, [stt, tts, send]);

  useEffect(() => {
    listenRef.current = listen;
  }, [listen]);

  const toggleMic = useCallback(() => {
    if (stt.listening) stt.stop();
    else listen();
  }, [stt, listen]);

  const stopSpeaking = useCallback(() => tts.cancel(), [tts]);

  const reset = useCallback(async () => {
    tts.cancel();
    stt.cancel();
    const old = sessionRef.current;
    const id = newId();
    sessionRef.current = id;
    setSessionId(id);
    setTurns([]);
    setError(null);
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {
      /* ignore */
    }
    if (old) api.reset(old).catch(() => {});
  }, [stt, tts]);

  const status: AgentStatus = stt.listening ? 'listening' : processing ? 'processing' : tts.speaking ? 'speaking' : 'idle';

  return {
    status,
    turns,
    sessionId,
    interim: stt.interim,
    error: error ?? stt.error,
    sttSupported: stt.supported,
    ttsSupported: tts.supported,
    autoSpeak,
    setAutoSpeak,
    handsFree,
    setHandsFree,
    toggleMic,
    stopSpeaking,
    send,
    reset,
  };
}
