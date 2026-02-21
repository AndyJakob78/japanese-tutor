# News Sourcing Skill

## Purpose
Find specific, current, interesting news stories for Japanese language learning articles.
The news should be **diverse** — not always finance or politics.

## CRITICAL: Topic Diversity
The #1 problem to avoid is generating repetitive articles about the same type of news (especially economics/finance).

### Rotation rules:
1. Look at the user's recent article topics — pick a COMPLETELY different category
2. Rotate across the user's configured regions (don't always default to Japan)
3. If the user's topics include "technology", "sports", "culture", "food" etc. — USE THEM, don't always fall back to politics/economy
4. Prefer human-interest stories, cultural events, sports, science, food, and technology over dry economic reports

### Example search variety across a week:
- "new Japanese anime film breaks box office record" (entertainment/japan)
- "Germany bans single-use plastics in restaurants" (environment/germany)
- "Mount Fuji gets new hiking rules for 2026" (travel/japan)
- "Berlin startup creates robot that delivers groceries" (technology/germany)
- "famous ramen shop opens first location in Los Angeles" (food/us)
- "Japanese astronaut selected for Moon mission" (science/japan)
- "Bundesliga season starts with surprise results" (sports/germany)

## Source Tiers by Category

### News & Current Events
- **Japan**: nhk.or.jp, japantimes.co.jp, mainichi.jp, asahi.com
- **Germany**: tagesschau.de, spiegel.de, zeit.de, dw.com
- **US/International**: reuters.com, bbc.com, apnews.com
- **Asia**: scmp.com, nikkeiasia.com

### Technology & Science
- **General**: theverge.com, arstechnica.com, wired.com
- **Japan tech**: japantimes.co.jp/tag/technology

### Sports
- **Japan**: japantimes.co.jp/sports, nhk.or.jp
- **Germany**: kicker.de, sport1.de
- **International**: espn.com, bbc.com/sport

### Culture, Food & Travel
- **Japan**: japantimes.co.jp/life, timeout.com/tokyo, japanesefood.about.com
- **Germany**: dw.com/culture, thelocal.de
- **Travel**: lonelyplanet.com, timeout.com

### Business & Economy (use sparingly — not every article!)
- **Japan**: nikkei.com, japantimes.co.jp/business
- **Germany**: handelsblatt.com, wiwo.de
- **International**: bloomberg.com, ft.com

## Search Strategy
1. **Match the target category** — if the pipeline says "technology", search for tech news, not economic news
2. Use date constraints: include current date or "today"/"this week" in searches
3. Search in English — the article will be written in Japanese for learners
4. Look for stories with concrete details: specific people, places, events, numbers

## Quality Criteria — A good news story MUST have:
- [ ] A specific event, person, or thing (not a vague trend)
- [ ] Concrete details (names, places, numbers)
- [ ] Be genuinely interesting to read about
- [ ] Be recent (within configured timeframe)
- [ ] Match one of the user's configured topics/regions

## Anti-Patterns — REJECT news that is:
- Vague ("the economy is changing")
- Recycled from weeks ago
- Only about stock prices or GDP numbers (unless the user specifically wants finance)
- Clickbait without substance
- Paywalled with no accessible summary
