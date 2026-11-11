// Article read aloud (2026-11-11)
//
// Google Cloud Text-to-Speech, Neural2 voices (the learner picked them over
// Apple's on-device Kyoko and the newer Chirp 3 HD voices), female or male. Articles are
// stored in romaji only, and a Japanese voice can't read romaji, so each
// sentence is converted to hiragana first (particles keep their sound:
// wa → わ, wo → を). Sentence by sentence so the app can show, repeat and skip
// sentences.
//
// Cost: Neural2 is ~$16 per 1M characters, the first 1M per month free; an
// article is ~800 characters. Every sentence is synthesized ONCE and cached in
// Firestore ("speech_cache", keyed by voice + text), so replays cost nothing
// and a text fix in an old article simply makes a new cache entry.

const crypto = require('crypto');
const wanakana = require('wanakana');
const { GoogleAuth } = require('google-auth-library');
const { collections } = require('./firestore');

// Learner picks female or male in the app (?voice=female|male)
const VOICES = { female: 'ja-JP-Neural2-B', male: 'ja-JP-Neural2-C' };
const DEFAULT_VOICE = 'female';
const voiceName = v => VOICES[v] || VOICES[DEFAULT_VOICE];
const PROJECT = process.env.GCP_PROJECT_ID || 'japanese-tutor-487503';
const MACRONS = { ā: 'aa', ī: 'ii', ū: 'uu', ē: 'ee', ō: 'ou' };

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const stripMarkers = t => String(t || '').replace(/\[(NEW|REVIEW)\]\s*/g, '');

/** Romaji article text → sentences, split the same way the app shows them. */
function splitSentences(body) {
  return (stripMarkers(body).match(/[^.!?]+[.!?]*/g) || [])
    .map(s => s.trim())
    .filter(s => /[A-Za-zāīūēō]/.test(s));
}

/** One romaji sentence → hiragana for the voice (never shown to the learner). */
function toSpeechKana(romaji) {
  const plain = stripMarkers(romaji)
    .toLowerCase()
    .replace(/[āīūēō]/g, c => MACRONS[c])
    .replace(/\(([^)]*)\)/g, ' ')        // "pāsento(pāsento)" — don't read it twice
    .replace(/-/g, ' ');
  return wanakana.toKana(plain, { IMEMode: false })
    .replace(/\./g, '。').replace(/,/g, '、').replace(/\?/g, '？').replace(/!/g, '！')
    .replace(/\s+/g, ' ')
    .trim();
}

async function synthesize(kana, name) {
  const client = await auth.getClient();
  const res = await client.request({
    url: 'https://texttospeech.googleapis.com/v1/text:synthesize',
    method: 'POST',
    headers: { 'x-goog-user-project': PROJECT },
    data: { input: { text: kana }, voice: { languageCode: 'ja-JP', name }, audioConfig: { audioEncoding: 'MP3' } },
  });
  return Buffer.from(res.data.audioContent, 'base64');
}

/** MP3 for one sentence, from the cache or freshly synthesized (then cached). */
async function sentenceAudio(romaji, voice) {
  const name = voiceName(voice);
  const kana = toSpeechKana(romaji);
  const key = crypto.createHash('sha1').update(`${name}|${kana}`).digest('hex');
  const ref = collections.speechCache.doc(key);
  const doc = await ref.get();
  if (doc.exists) return doc.data().audio;
  const audio = await synthesize(kana, name);
  await ref.set({ voice: name, kana, audio, bytes: audio.length, created_at: new Date().toISOString() });
  return audio;
}

module.exports = { VOICES, DEFAULT_VOICE, voiceName, splitSentences, toSpeechKana, sentenceAudio };
