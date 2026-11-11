// Voiceover lines → voice/*.mp3 (Google Cloud TTS, project japanese-tutor-487503). usage: node tts.js [voice] [only=7,7ja]
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const voice = (process.argv[2] && !process.argv[2].startsWith('only=') && process.argv[2]) || 'en-US-Chirp3-HD-Aoede';
const only = (process.argv.find(a => a.startsWith('only=')) || '').slice(5).split(',').filter(Boolean);
const LINES = [
  ['1', 'en-US', voice, 'Okay, polyglots! Want to read real Japanese news?'],
  ['2', 'en-US', voice, 'Fresh articles from today\'s headlines, written at your level.'],
  ['3', 'en-US', voice, 'Don\'t know a word? Just tap it.'],
  ['4', 'en-US', voice, 'Hear every sentence in a natural Japanese voice.'],
  ['4ja', 'ja-JP', 'ja-JP-Neural2-B', 'こうじょう の ふるい たてもの も みられます。'],
  ['5', 'en-US', voice, 'Then write your own. Mistakes get fixed, and explained.'],
  ['6', 'en-US', voice, 'Quizzes and daily review make every word stick.'],
  ['7', 'en-US', voice, 'Japanese AI News Learner.'],
  // an English voice says "Ganbatte" badly ("gemba..."), so the Japanese voice says it
  ['7ja', 'ja-JP', 'ja-JP-Neural2-B', 'がんばって！'],
];
const token = execSync('gcloud auth print-access-token').toString().trim();
(async () => {
  for (const [id, lang, name, text] of LINES.filter(l => !only.length || only.includes(l[0]))) {
    const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': 'japanese-tutor-487503', 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text }, voice: { languageCode: lang, name }, audioConfig: { audioEncoding: 'MP3', sampleRateHertz: 44100 } }),
    });
    const j = await r.json();
    if (j.error) { console.log(id, 'ERROR', j.error.message); continue; }
    fs.writeFileSync(path.join(__dirname, 'voice', `${id}.mp3`), Buffer.from(j.audioContent, 'base64'));
  }
  console.log('done');
})();
