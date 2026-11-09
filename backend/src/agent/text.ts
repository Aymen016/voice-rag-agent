/**
 * Pure text helpers for model output. Kept free of Nest imports so they are
 * easy to unit test.
 */

/** Matches [S1], [S1, S2], [ S3 ] after normalization. */
export const CITATION_RE = /\[\s*(S\d+(?:\s*,\s*S\d+)*)\s*\]/g;

/**
 * Models sometimes wrap citations in zero-width spaces ("[​S23​]"),
 * use CJK brackets ("【S1】"), or glue citations together ("[S9][S6]").
 * Non-breaking hyphens ("INV‑1043") also break later regexes.
 * Normalize all of that before anything else reads the answer.
 */
export function normalizeModelText(s: string): string {
  return s
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[【〔［]/g, '[')
    .replace(/[】〕］]/g, ']')
    .replace(/[‐‑‒]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\]\s*\[(?=\s*S\d)/g, ', ') // [S9][S6] -> [S9, S6]
    .replace(/([a-z0-9)\]][.!?])(?=[A-Z])/g, '$1 ') // "week.Is" -> "week. Is"
    .trim();
}

export function extractCitationIds(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(CITATION_RE)) {
    for (const id of m[1].split(',')) {
      const clean = id.trim();
      if (!ids.includes(clean)) ids.push(clean);
    }
  }
  return ids;
}

/** Keep only citation ids that `isKnown` accepts; drop brackets that end up empty. */
export function filterCitations(text: string, isKnown: (id: string) => boolean): string {
  return text
    .replace(CITATION_RE, (_full, group: string) => {
      const valid = group
        .split(',')
        .map((s) => s.trim())
        .filter(isKnown);
      return valid.length ? ` [${valid.join(', ')}]` : '';
    })
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Text-to-speech friendly: no citations, markdown, list markers or symbols read aloud. */
export function toSpeech(text: string): string {
  return normalizeModelText(text)
    .replace(CITATION_RE, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/[*_#`>|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/([.!?])?[:;]?\s+[-•]\s+(?=[A-Z])/g, (_m, end?: string) => (end ? `${end} ` : '. ')) // inline "plans: - Free ... - Pro" -> sentences
    .replace(/(^|\s)\d+\.\s+(?=[A-Z])/g, '$1') // "1. Make sure" -> "Make sure"
    .replace(/→|->/g, ', then ')
    .replace(/\b(?:invoice\s+)?INV-(\d+)/gi, 'invoice $1')
    .replace(/\bCN-(\d+)/g, (_m, d: string) => `C N ${d.split('').join(' ')}`)
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
