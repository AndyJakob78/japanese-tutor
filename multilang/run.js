// Try the German / English pipeline without touching the app or the database.
//
//   node multilang/run.js search de ["topic wish"]   → multilang/out/news-de.json
//   node multilang/run.js de A1-A2                   → multilang/out/de-A1-A2.json + .md
//   node multilang/run.js en all                     → all three levels, same news
//
// A level run uses out/news-<lang>.json; run "search" first.

const fs = require('fs');
const path = require('path');
const { generate, searchNews, LANGS } = require('./generate');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

function toMarkdown(a) {
  const body = a.body.replace(/\[NEW\] ([\p{L}'’-]+)/gu, '**$1**');
  return `# ${a.title}\n\n*${LANGS[a.language].name}, level ${a.level} — ${a.word_count} words — ${a._timings.total} s (writer ${a._timings.writer}, reviewer ${a._timings.reviewer}, quiz ${a._timings.quiz})*\n\n` +
    `> ${a.summary}\n\n${body}\n\n## 日本語訳\n\n${a.translation_ja}\n\n## 単語\n\n| 単語 | 辞書形 | 意味 | 例文 |\n|---|---|---|---|\n` +
    a.vocabulary.map(v => `| ${v.word} | ${v.base} | ${v.meaning_ja} | ${v.example} — ${v.example_ja} |`).join('\n') +
    (a.grammar_note ? `\n\n## 文法\n\n**${a.grammar_note.point}** — ${a.grammar_note.explanation_ja}\n\n> ${a.grammar_note.sentence}` : '') +
    `\n\n## クイズ\n\n` + a.quiz.map((q, i) => `${i + 1}. *${q.instruction_ja}*\n   ${q.question}\n` +
      q.options.map((o, k) => `   - ${k === q.answer_index ? '✅' : '▫️'} ${o}`).join('\n') + `\n   ${q.explanation_ja}`).join('\n\n') +
    `\n\n---\n\n**Checks**\n\n- Code check before the reviewer: ${a._lint_before.length ? '\n' + a._lint_before.map(x => `  - ${x}`).join('\n') : 'nothing'}\n` +
    `- Reviewer fixes: ${a._reviewer_fixes.length ? '\n' + a._reviewer_fixes.map(x => `  - ${x}`).join('\n') : 'none'}\n` +
    `- Code check after the reviewer: ${a.lint_warnings.length ? '\n' + a.lint_warnings.map(x => `  - ${x}`).join('\n') : 'nothing left'}\n` +
    `- Quiz check: ${a._quiz_problems.length ? a._quiz_problems.join('; ') : 'ok'}\n`;
}

(async () => {
  const [a, b, c] = process.argv.slice(2);
  if (a === 'search') {
    if (!LANGS[b]) throw new Error('usage: run.js search de|en ["topic wish"]');
    const t = Date.now();
    const news = await searchNews(b, c);
    fs.writeFileSync(path.join(OUT, `news-${b}.json`), JSON.stringify(news, null, 2));
    console.log(`search ${b}: ${Math.round((Date.now() - t) / 1000)}s — ${news.topic}`);
    return;
  }
  if (!LANGS[a]) throw new Error('usage: run.js de|en A1-A2|B1|B2|all');
  const news = JSON.parse(fs.readFileSync(path.join(OUT, `news-${a}.json`), 'utf8'));
  const levels = !b || b === 'all' ? Object.keys(LANGS[a].levels) : [b];
  await Promise.all(levels.map(async level => {
    const art = await generate(a, level, news);
    fs.writeFileSync(path.join(OUT, `${a}-${level}.json`), JSON.stringify(art, null, 2));
    fs.writeFileSync(path.join(OUT, `${a}-${level}.md`), toMarkdown(art));
  }));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
