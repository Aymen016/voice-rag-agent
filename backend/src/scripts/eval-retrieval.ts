/**
 * Retrieval evaluation: paraphrased questions (wording deliberately different
 * from the documents) vs. the document that should answer them.
 *
 * Compares semantic search against a plain keyword-overlap baseline, and
 * prints hit@1, hit@3 and MRR for both, plus the scores of out-of-scope
 * questions (which should fall below SEARCH_SUFFICIENT_SCORE).
 *
 *   npm run eval:retrieval
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as fs from 'fs';
import * as path from 'path';
import { AppModule } from '../app.module';
import { cfg } from '../config';
import { KbService } from '../kb/kb.service';

const CASES: { q: string; expect: string }[] = [
  { q: 'Can I get my money back if I am not happy with the service?', expect: '03-refund-and-cancellation-policy' },
  { q: 'I was billed two times this month', expect: '02-billing-and-payments' },
  { q: 'What happens to stuff I throw away?', expect: '07-deleted-files-and-data-retention' },
  { q: 'How do I stop strangers from getting into my account?', expect: '04-account-security' },
  { q: 'My laptop changes are not appearing on my phone', expect: '05-sync-troubleshooting' },
  { q: 'How big a video can I upload?', expect: '08-storage-limits-and-quotas' },
  { q: 'How fast will someone get back to me if I write in?', expect: '09-support-and-service-levels' },
  { q: 'Can my friend see my folder without paying?', expect: '06-sharing-and-permissions' },
  { q: 'Is my stuff kept in Europe?', expect: '10-privacy-and-data-location' },
  { q: 'How much is the team plan?', expect: '01-plans-and-pricing' },
  { q: 'My card got declined, will I lose my files?', expect: '02-billing-and-payments' },
  { q: 'I lost my phone with the authenticator app', expect: '04-account-security' },
  { q: 'Two versions of the same document showed up', expect: '05-sync-troubleshooting' },
  { q: 'Can I undo changes to a spreadsheet from last month?', expect: '07-deleted-files-and-data-retention' },
  { q: 'Do charities get a cheaper price?', expect: '01-plans-and-pricing' },
  { q: 'Can I pay with Bitcoin?', expect: '02-billing-and-payments' },
];

// Not answerable from the docs. Note the student question still lands on the
// discounts section with a moderate score: a similarity threshold alone cannot
// separate it, which is why the agent also verifies answers against passages.
const OUT_OF_SCOPE = ['Do you have a student discount?', 'What is the weather in Lahore today?', 'Is there an Android home-screen widget?'];

function tokens(s: string) {
  return s.toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) ?? [];
}
const STOP = new Set(['the', 'and', 'for', 'are', 'can', 'how', 'what', 'my', 'this', 'that', 'with', 'from', 'you', 'your', 'not', 'will', 'does', 'get', 'any', 'all', 'has', 'have', 'into', 'out', 'too']);

function keywordRank(q: string, docs: { id: string; text: string }[]) {
  const qt = new Set(tokens(q));
  return docs
    .map((d) => {
      const dt = tokens(d.text);
      const hits = dt.filter((w) => qt.has(w)).length;
      return { id: d.id, score: hits / Math.sqrt(dt.length || 1) };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}

function metrics(ranks: (number | null)[]) {
  const n = ranks.length;
  return {
    hit1: ranks.filter((r) => r === 1).length / n,
    hit3: ranks.filter((r) => r !== null && r <= 3).length / n,
    mrr: ranks.reduce<number>((s, r) => s + (r ? 1 / r : 0), 0) / n,
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  const kb = app.get(KbService);
  await kb.ensureReady();

  const dir = cfg().kb.dir;
  const docs = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => ({ id: f.replace(/\.md$/, ''), text: fs.readFileSync(path.join(dir, f), 'utf8') }));

  const semRanks: (number | null)[] = [];
  const kwRanks: (number | null)[] = [];
  console.log('\nQUESTION (paraphrased)                                   SEMANTIC top doc (score)                     KW rank  SEM rank');
  console.log('-'.repeat(132));
  for (const c of CASES) {
    const hits = await kb.search(c.q, 20, 0);
    const docOrder = [...new Set(hits.map((h) => h.docId))];
    const semRank = docOrder.indexOf(c.expect) + 1 || null;
    const kwRank = keywordRank(c.q, docs).indexOf(c.expect) + 1 || null;
    semRanks.push(semRank);
    kwRanks.push(kwRank);
    const top = hits[0];
    console.log(
      `${c.q.padEnd(56).slice(0, 56)} ${`${top.docId.slice(3, 38)} > ${top.section}`.slice(0, 40).padEnd(40)} (${top.score.toFixed(2)})  ${String(kwRank ?? '-').padStart(6)}  ${String(semRank ?? '-').padStart(8)}`,
    );
  }

  const s = metrics(semRanks);
  const k = metrics(kwRanks);
  console.log('\n                      hit@1   hit@3   MRR');
  console.log(`Semantic search       ${s.hit1.toFixed(2)}    ${s.hit3.toFixed(2)}    ${s.mrr.toFixed(2)}`);
  console.log(`Keyword baseline      ${k.hit1.toFixed(2)}    ${k.hit3.toFixed(2)}    ${k.mrr.toFixed(2)}`);

  console.log(`\nOut-of-scope questions (should score below sufficient threshold ${cfg().kb.sufficientScore}):`);
  for (const q of OUT_OF_SCOPE) {
    const [top] = await kb.search(q, 1, 0);
    const verdict = top.score >= cfg().kb.sufficientScore ? 'above threshold -> verifier must catch it' : 'weak -> agent re-queries or declines';
    console.log(`  ${q.padEnd(40)} top=${top.score.toFixed(2)} ${top.docId} > ${top.section}  => ${verdict}`);
  }
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
