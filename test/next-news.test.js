const test = require('node:test');
const assert = require('node:assert');
const { storyKey, usable } = require('../agent/next-news');

const config = { topics: ['food', 'travel'], regions: ['tokyo'], proficiency_level: 'N4' };
const now = Date.parse('2026-11-24T12:00:00Z');
const story = (over = {}) => ({ key: storyKey(config), created_at: '2026-11-24T10:00:00Z',
  newsData: { topic: 'Record October for visitors', articles: [{ url: 'https://example.jp/a' }] }, ...over });

test('a fresh story for the same settings is used', () => assert.equal(usable(story(), config, [], now), true));
test('topic order and case do not matter', () =>
  assert.equal(usable(story(), { ...config, topics: ['Travel', 'FOOD'] }, [], now), true));
test('changed topics, places or level: not used', () => {
  assert.equal(usable(story(), { ...config, topics: ['sport'] }, [], now), false);
  assert.equal(usable(story(), { ...config, regions: ['osaka'] }, [], now), false);
  assert.equal(usable(story(), { ...config, proficiency_level: 'N3' }, [], now), false);
});
test('a custom topic always searches', () => assert.equal(usable(story(), { ...config, custom_topic: 'MLB' }, [], now), false));
test('older than 12 hours: not used', () =>
  assert.equal(usable(story({ created_at: '2026-11-23T23:00:00Z' }), config, [], now), false));
test('a story the learner already read (same topic or same source): not used', () => {
  assert.equal(usable(story(), config, [{ topic: 'record october for visitors' }], now), false);
  assert.equal(usable(story(), config, [{ topic: 'x', sources: [{ url: 'https://example.jp/a' }] }], now), false);
});
test('empty or missing story: not used', () => {
  assert.equal(usable(null, config, [], now), false);
  assert.equal(usable(story({ newsData: { topic: 't', articles: [] } }), config, [], now), false);
});
