// The next story, found in the background (2026-11-24).
// The news search takes 20–50 s of every article. Right after an article is saved, the server
// already searches for the NEXT story and keeps it here (one document per learner). The next
// article skips the search when the stored story still fits: same topics, places and level,
// no custom topic, not older than MAX_AGE_H (48 h), and not a story the learner already read.
// Same search, same checks — it only happens earlier, while the learner reads.

const MAX_AGE_H = 48; // owner, 2026-11-24 (matches the 48 h news window)

/** What the story depends on: a change in Settings makes the stored story unusable. */
function storyKey(config) {
  const sorted = a => [...(a || [])].map(x => String(x).toLowerCase()).sort();
  return JSON.stringify({ t: sorted(config.topics), r: sorted(config.regions), l: config.proficiency_level || '' });
}

/** Pure check (tested): may this stored story be used for an article now? */
function usable(stored, config, recentArticles, now = Date.now()) {
  if (!stored || !stored.newsData || !Array.isArray(stored.newsData.articles) || !stored.newsData.articles.length) return false;
  if (config.custom_topic) return false;
  if (stored.key !== storyKey(config)) return false;
  const age = now - Date.parse(stored.created_at || 0);
  if (!(age >= 0 && age < MAX_AGE_H * 3600 * 1000)) return false;
  const topic = String(stored.newsData.topic || '').trim().toLowerCase();
  const urls = new Set(stored.newsData.articles.map(a => a.url).filter(Boolean));
  return !(recentArticles || []).slice(0, 15).some(r =>
    (topic && String(r.topic || '').trim().toLowerCase() === topic) ||
    (r.sources || []).some(s => s.url && urls.has(s.url)));
}

/** Take the stored story if it fits (and remove it, so it is used once). Never throws. */
async function takeStory(collections, userId, config, recentArticles) {
  try {
    const ref = collections.nextNews.doc(userId);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const stored = snap.data();
    await ref.delete();
    return usable(stored, config, recentArticles) ? stored.newsData : null;
  } catch (e) {
    console.warn(`[Next news] could not read: ${e.message}`);
    return null;
  }
}

/** Search the next story in the background and keep it. Never throws. */
async function prepareStory(collections, userId, config, recentArticles, search) {
  if (config.custom_topic) {   // a one-off topic: the next story follows the learner's normal topics
    config = { ...config }; delete config.custom_topic;
  }
  try {
    const t = Date.now();
    const newsData = await search(config, userId, recentArticles, []);
    if (!newsData || !Array.isArray(newsData.articles) || !newsData.articles.length) return;
    await collections.nextNews.doc(userId).set({ key: storyKey(config), created_at: new Date().toISOString(), newsData });
    console.log(`[Next news] ready in ${((Date.now() - t) / 1000).toFixed(1)}s: "${String(newsData.topic || '').slice(0, 80)}"`);
  } catch (e) {
    console.warn(`[Next news] failed: ${e.message}`);
  }
}

module.exports = { storyKey, usable, takeStory, prepareStory, MAX_AGE_H };
