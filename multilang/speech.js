// Read aloud for German / English: Google Cloud Text-to-Speech, Neural2
// voices, one sentence at a time — the same service and the same cache
// ("speech_cache") as the Japanese version. No conversion is needed: the
// voice reads the article text as written.

const crypto = require('crypto');
const { GoogleAuth } = require('google-auth-library');
const { collections } = require('../server/services/firestore');
const { splitSentences } = require('./lint');

// checked against the voice list on 2026-11-21
const VOICES = {
  de: { code: 'de-DE', female: 'de-DE-Neural2-G', male: 'de-DE-Neural2-H' },
  en: { code: 'en-US', female: 'en-US-Neural2-F', male: 'en-US-Neural2-D' },
};
const PROJECT = process.env.GCP_PROJECT_ID || 'japanese-tutor-487503';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const sentencesOf = (article, lang) => splitSentences(article.body, lang);

/** MP3 of one sentence, from the cache or freshly made (then cached). */
async function sentenceAudio(text, langKey, voice) {
  const v = VOICES[langKey];
  const name = v[voice] || v.female;
  const key = crypto.createHash('sha1').update(`${name}|${text}`).digest('hex');
  const ref = collections.speechCache.doc(key);
  const doc = await ref.get();
  if (doc.exists) return doc.data().audio;
  const client = await auth.getClient();
  const res = await client.request({
    url: 'https://texttospeech.googleapis.com/v1/text:synthesize', method: 'POST',
    headers: { 'x-goog-user-project': PROJECT },
    data: { input: { text }, voice: { languageCode: v.code, name }, audioConfig: { audioEncoding: 'MP3' } },
  });
  const audio = Buffer.from(res.data.audioContent, 'base64');
  await ref.set({ voice: name, text, audio, bytes: audio.length, created_at: new Date().toISOString() });
  return audio;
}

module.exports = { VOICES, sentencesOf, sentenceAudio };
