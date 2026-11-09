export interface KbDocument {
  id: string; // file name without extension, e.g. "03-refund-and-cancellation-policy"
  file: string;
  title: string;
  content: string;
}

export interface KbChunk {
  id: string; // `${docId}#${n}`
  docId: string;
  docTitle: string;
  file: string;
  section: string;
  text: string; // body text shown to the user and the LLM
  embedText: string; // what gets embedded: title + section + body for context
}

const MAX_CHARS = 900;

/**
 * Structure-aware chunking for markdown:
 * 1. split on "## " headings so every chunk stays inside one topic,
 * 2. split long sections on paragraph boundaries with one paragraph of overlap,
 * 3. prefix the embedded text with "Document > Section" so short chunks still
 *    carry their context (helps a lot with small embedding models).
 */
export function parseDocument(file: string, raw: string): KbDocument {
  const id = file.replace(/\.md$/i, '');
  const titleMatch = raw.match(/^#\s+(.+)$/m);
  return { id, file, title: titleMatch ? titleMatch[1].trim() : id, content: raw };
}

export function chunkDocument(doc: KbDocument): KbChunk[] {
  const lines = doc.content.replace(/\r\n/g, '\n').split('\n');
  const sections: { heading: string; body: string[] }[] = [{ heading: 'Overview', body: [] }];

  for (const line of lines) {
    if (/^#\s+/.test(line)) continue; // document title
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      sections.push({ heading: h[1].trim(), body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }

  const chunks: KbChunk[] = [];
  for (const section of sections) {
    const body = section.body.join('\n').trim();
    if (!body) continue;
    for (const piece of splitLong(body)) {
      const n = chunks.length;
      chunks.push({
        id: `${doc.id}#${n}`,
        docId: doc.id,
        docTitle: doc.title,
        file: doc.file,
        section: section.heading,
        text: piece,
        embedText: `${doc.title} > ${section.heading}\n${stripMarkdown(piece)}`,
      });
    }
  }
  return chunks;
}

function splitLong(body: string): string[] {
  if (body.length <= MAX_CHARS) return [body];
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let current: string[] = [];
  let len = 0;
  for (const p of paras) {
    if (len + p.length > MAX_CHARS && current.length) {
      out.push(current.join('\n\n'));
      const overlap = current[current.length - 1];
      current = overlap.length < MAX_CHARS / 2 ? [overlap] : [];
      len = current.reduce((s, x) => s + x.length, 0);
    }
    current.push(p);
    len += p.length;
  }
  if (current.length) out.push(current.join('\n\n'));
  return out;
}

export function stripMarkdown(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').trim();
}
