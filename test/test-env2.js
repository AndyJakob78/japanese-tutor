const path = require('path');
const dotenvResult = require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('parsed:', dotenvResult.parsed);
console.log('process.env.ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY);
console.log('parsed key:', dotenvResult.parsed ? dotenvResult.parsed.ANTHROPIC_API_KEY : 'N/A');

const envVars = { ...dotenvResult.parsed, ...process.env };
console.log('merged key:', envVars.ANTHROPIC_API_KEY);
console.log('merged key length:', envVars.ANTHROPIC_API_KEY ? envVars.ANTHROPIC_API_KEY.length : 0);
