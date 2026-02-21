require('dotenv').config();

const key = process.env.ANTHROPIC_API_KEY;

if (!key || key === 'your-api-key-here') {
  console.log('NOT SET — your API key is still the placeholder.');
  console.log('Please edit the .env file and replace "your-api-key-here" with your real key.');
  process.exit(1);
} else {
  console.log('API key is set (' + key.substring(0, 12) + '...' + key.substring(key.length - 4) + ')');
  console.log('You are ready to run the pipeline!');
}
