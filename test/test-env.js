const path = require('path');
const result = require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
console.log('dotenv result:', result.error ? 'ERROR: ' + result.error : 'OK');
console.log('parsed keys:', result.parsed ? Object.keys(result.parsed) : 'none');

const key = process.env.ANTHROPIC_API_KEY;
console.log('key set:', !!key);
console.log('key length:', key ? key.length : 0);
console.log('key starts with:', key ? key.substring(0, 15) : 'N/A');
