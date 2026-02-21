// Entry point for the Japanese Tutor API server

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Increase timeout for article generation (pipeline makes 4-5 Claude calls, may hit rate limits)
app.use('/api/articles/generate', (req, res, next) => {
  req.setTimeout(600000); // 10 minutes
  res.setTimeout(600000);
  next();
});

// Keep-alive: set server timeout high so Cloud Run doesn't kill the connection
app.use((req, res, next) => {
  res.setHeader('Connection', 'keep-alive');
  next();
});

// Health check (before user-id middleware so it works without a header)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// User ID middleware — extract from X-User-ID header
// Every API request must include this header for per-user data isolation.
const { initializeConfigForUser } = require('./services/firestore');
const knownUsers = new Set();

app.use('/api', async (req, res, next) => {
  const userId = req.headers['x-user-id'];
  if (!userId) {
    return res.status(400).json({ error: 'Missing X-User-ID header' });
  }
  req.userId = userId;

  // On first request from a new user, initialize their default config
  if (!knownUsers.has(userId)) {
    try {
      await initializeConfigForUser(userId);
      knownUsers.add(userId);
    } catch (err) {
      console.error(`Failed to initialize config for user ${userId}:`, err.message);
      // Don't block the request — config will be created lazily
      knownUsers.add(userId);
    }
  }

  next();
});

// Routes
app.use('/api/articles', require('./routes/articles'));
app.use('/api/vocabulary', require('./routes/vocabulary'));
app.use('/api/articles', require('./routes/quiz')); // quiz routes are under /api/articles/:id/quiz
app.use('/api/config', require('./routes/config'));
app.use('/api/stats', require('./routes/stats'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Japanese Tutor API running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
