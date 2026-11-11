// JLPT level reference — authoritative word→level lookup.
//
// THE PROBLEM (article #149): Claude self-assigns `jlpt_level` to each vocab
// word, and it systematically UNDER-tags — labelling 一致 (N2), 連立 (N1),
// 延長 (N3) all as "N4". Our validator #9 and the level-retry loop trust those
// tags, so they never fire, and an "N4" article is really N3/N2.
//
// This module holds a curated reference of common news/politics/finance/tech
// vocabulary at N3/N2/N1 (the levels that drift). When a generated word appears
// here, we OVERWRITE Claude's tag with the reference level — then the existing
// validator/retry machinery correctly catches above-target words.
//
// Coverage note: this is a focused list of the ~250 words most likely to drift
// in this app's domains, NOT a complete JLPT dictionary. Words not in the list
// keep Claude's self-tag (best effort). At the N2/N3 boundary we bias toward the
// HIGHER level so we never under-flag. Accuracy > completeness — a word here is
// only added when its level is well established.

// Each set lists standard-form kanji. Keyed lookups also try kana + romaji.
const LEVEL_WORDS = {
  N5: [
    '日本', '人', '国', '年', '月', '日', '車', '家', '水', '手', '目', '口',
    '大学', '学生', '先生', '会社', '時間', '電話', '電車', '町', '店', '駅',
    '大きい', '小さい', '新しい', '古い', '高い', '安い', '見る', '行く', '来る',
    '食べる', '飲む', '話す', '書く', '読む', '買う', '作る', '使う',
  ],
  N4: [
    '意見', '予定', '説明', '会議', '世界', '特別', '用意', '準備', '約束',
    '受付', '注意', '返事', '相談', '安全', '自由', '簡単', '複雑',
    '生活', '文化', '習慣', '規則', '意味', '理由', '結果', '原因',
    '支払い', '小売', '防衛', '協力', '終わる', '始まる', '決める', '選ぶ',
    // moved from N3 2026-10-18: standard N4 lists (e.g. Tanos) include these
    '経済', '政治', '社会', '技術', '計画', '研究', '産業', '工場', '必要',
    '建物', '将来', '経験', '関係',
    // added 2026-10-18 from articles #186/#188
    '珍しい', '詳しい', '預ける', '困る', '減る', '時代', '銀行', '悲しい',
  ],
  N3: [
    '政府', '政策', '環境', '開発',
    '企業', '投資', '議員', '延長', '期間', '人口', '暖房', '導入',
    '管理', '成長', '記念', '製造', '運用', '確認', '調査',
    '分析', '登録', '作成', '決定', '開催', '参加', '実施', '改善', '提供',
    '使用', '操作', '影響', '状況', '情報', '対策', '必要',
    '発表', '可能性', '価値', '費用', '解決', '目的', '方法', '内容', '意味',
    '需要', '供給', '効果', '効率', '機能', '性能', '設計', '製品', '販売',
    '市場', '施設', '現場', '担当', '責任', '義務', '権利',
    '規制', '許可', '禁止', '制限', '条件', '基準', '評価', '判断', '選挙',
    '首相', '大臣', '知事', '市長', '警察', '裁判', '法律', '違反', '犯罪',
    '被害', '事件', '事故', '災害', '対応', '支援', '協定', '交渉',
    // added 2026-10-18 from articles #186/#188
    '年金', '交代', '地域', '労働', '厳しい', '政治家',
  ],
  N2: [
    '一致', '買収', '合併', '株式', '株価', '配当', '報酬', '放送', '思想',
    '戦略', '収入', '集中', '要求', '対象', '対照', '分類', '保有', '取引',
    '首都', '与党', '野党', '内閣', '省庁', '官僚', '政権', '法案', '可決',
    '否決', '審議', '採決', '議会', '委員会', '憲法', '改正', '施行', '制度',
    '財政', '予算', '税制', '金融', '融資', '債券', '証券', '為替', '介入',
    '景気', '物価', '利益', '損失', '倒産', '破綻', '製薬', '半導体', '検知',
    '導体', '装置', '設備', '機器', '素材', '材料', '構造', '仕組み', '効能',
    '概念', '要素', '傾向', '現象', '影響力', '主権', '独自', '普及', '実用',
    '本格', '大手', '新興', '設立', '創業', '拡大', '縮小', '削減', '強化',
    // added 2026-10-18 from articles #186/#188
    '資産', '組織', '合意', '批判', '改革', '注目', '政党', '国会', '経営',
  ],
  N1: [
    '連立', '与野党', '時価総額', '公債', '国債', '歳出', '歳入', '貨幣',
    '斡旋', '罷免', '弾劾', '象徴', '払拭', '踏襲', '呼応', '弱電', '強電',
    '媒体', '概観', '網羅', '喚起', '示唆', '委嘱', '布石', '包括',
    // added 2026-10-18 from articles #186/#188
    '協議', '兆候', '辞任',
  ],
};

const LEVEL_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1'];

// Build kanji → level map. Ignore any non-Japanese guard entries.
const KANJI_TO_LEVEL = {};
for (const [level, words] of Object.entries(LEVEL_WORDS)) {
  for (const w of words) {
    // skip guards / latin
    if (!/[぀-ヿ一-鿿]/.test(w)) continue;
    if (!KANJI_TO_LEVEL[w]) KANJI_TO_LEVEL[w] = level;
  }
}

// Full JLPT list (~8,100 words, Jonathan Waller / tanos.co.uk, CC BY — see
// data/jlpt-vocab/NOTICE.md) as the fallback behind the curated list above.
// Loaded once at startup into in-memory maps; lookups are O(1), no API calls.
// A word listed at several levels gets the EASIEST one (where it's first
// expected). Kana keys hold only words the list writes in kana, so homophones
// (にんき = 人気 or 任期) never resolve by reading.
const FULL_KANJI_TO_LEVEL = {};
const FULL_KANA_TO_LEVEL = {};
// First kanji + reading → easiest level. The list writes some N4 verbs with old
// okurigana (上る / 下る read あがる / さがる) and the modern spelling 上がる /
// 下がる only at N1, so 下がる alone looked like an N1 word (2026-11-10).
const FIRST_KANJI_READING_TO_LEVEL = {};
(function loadFullList() {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, 'data', 'jlpt-vocab');
  for (const level of LEVEL_ORDER) {
    const file = path.join(dir, `${level.toLowerCase()}_vocab_cleaned.csv`);
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(1);
    for (const line of lines) {
      const [rawWord, rawReading] = line.split(',');
      const word = (rawWord || '').trim();
      if (!word || !/[぀-ヿ一-鿿]/.test(word)) continue;
      const easier = (map, key) => {
        const prev = map[key];
        if (!prev || LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf(prev)) map[key] = level;
      };
      easier(/[一-鿿]/.test(word) ? FULL_KANJI_TO_LEVEL : FULL_KANA_TO_LEVEL, word);
      const reading = (rawReading || '').trim();
      if (/^[一-鿿]/.test(word) && reading) easier(FIRST_KANJI_READING_TO_LEVEL, `${word[0]}|${reading}`);
    }
  }
})();

/**
 * Look up the reference level for a vocab entry. Tries the curated list by
 * word_kanji (and its stem), then the full JLPT list by word_kanji (and stem),
 * then — only for words without kanji — the full list by word_kana.
 * Returns 'N5'..'N1' or null if not in the reference.
 */
function lookupLevel(entry) {
  if (!entry) return null;
  const kanji = (entry.word_kanji || '').trim();
  if (kanji && KANJI_TO_LEVEL[kanji]) return KANJI_TO_LEVEL[kanji];
  // Strip trailing する / な / い okurigana variants and retry the stem.
  const stem = kanji.replace(/(する|な|に|い)$/, '');
  if (stem && stem !== kanji && KANJI_TO_LEVEL[stem]) return KANJI_TO_LEVEL[stem];
  if (kanji && /[一-鿿]/.test(kanji)) {
    const full = FULL_KANJI_TO_LEVEL[kanji] || (stem && stem !== kanji && FULL_KANJI_TO_LEVEL[stem]) || null;
    const kana = (entry.word_kana || '').trim();
    // Same first kanji + same reading (下がる = 下る さがる, N4)
    const variant = /^[一-鿿]/.test(kanji) && kana ? FIRST_KANJI_READING_TO_LEVEL[`${kanji[0]}|${kana}`] : null;
    // The list writes some everyday words only in kana (できる N5, たくさん N5); their kanji
    // spelling is missing or listed at a rare level. Without this, 出来る matched 出切る (N1)
    // through the variant map (2026-11-11). The kana map holds only kana-written words, so
    // homophones written in kanji (にんき 人気 / 任期) still don't resolve by reading.
    const kanaOnly = kana ? FULL_KANA_TO_LEVEL[kana] || null : null;
    // When the list knows the exact spelling, the variant map is only a tiebreak toward easier levels;
    // when it doesn't, prefer the kana entry over a different word that shares the first kanji.
    const candidates = full ? [full, variant, kanaOnly] : kanaOnly ? [kanaOnly] : [variant];
    return candidates.filter(Boolean).sort((x, y) => LEVEL_ORDER.indexOf(x) - LEVEL_ORDER.indexOf(y))[0] || null;
  }
  const kana = (entry.word_kana || kanji || '').trim();
  return FULL_KANA_TO_LEVEL[kana] || null;
}

/**
 * Correct the jlpt_level tags on a list of vocab entries using the reference.
 * Overwrites Claude's self-assigned tag with the authoritative level wherever
 * the word is found. Returns { corrected: [{word, from, to}], count }.
 */
function correctVocabLevels(newWords) {
  const corrected = [];
  for (const w of (newWords || [])) {
    const ref = lookupLevel(w);
    if (!ref) continue;
    if (w.jlpt_level !== ref) {
      corrected.push({ word: w.word_romaji_macron || w.word_kanji, from: w.jlpt_level, to: ref });
      w.jlpt_level = ref;
    }
  }
  return { corrected, count: corrected.length };
}

module.exports = {
  lookupLevel,
  correctVocabLevels,
  LEVEL_ORDER,
  _internals: { KANJI_TO_LEVEL, FULL_KANJI_TO_LEVEL, FULL_KANA_TO_LEVEL },
};
