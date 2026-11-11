# App Store Submission Checklist

Complete these steps in order. Each step links to where you do it.

---

## Step 1 — Enable GitHub Pages (Privacy Policy URL)

The App Store requires a live privacy policy URL before you can submit.

1. Push the `docs/` folder to GitHub:
   ```bash
   git add docs/
   git commit -m "Add GitHub Pages site with privacy policy"
   git push
   ```
2. Go to **https://github.com/AndyJakob78/japanese-tutor/settings/pages**
3. Under "Build and deployment" → Source → select **Deploy from a branch**
4. Branch: `master`, Folder: `/docs` → click **Save**
5. Wait ~2 minutes. Your privacy policy will be live at:
   ```
   https://andyjakob78.github.io/japanese-tutor/privacy-policy.html
   ```
6. Test the URL in your browser before continuing.

---

## Step 2 — Update Bundle ID in Xcode

The bundle ID must be unique on the App Store and match App Store Connect.

1. Open `JapaneseTutor.xcodeproj` in Xcode
2. Click the project in the sidebar → Target "JapaneseTutor" → General tab
3. Change **Bundle Identifier** to something unique, e.g.:
   ```
   com.andreasjakob.NihongoNews
   ```
4. Also update the **Display Name** (shown under the app icon) to:
   ```
   Nihongo News
   ```

---

## Step 3 — Verify the App Icon in Xcode

1. In Xcode, open `Assets.xcassets` → `AppIcon`
2. Confirm the 1024×1024 icon is showing (no "romaji" text — it should be the clean 文 design)
3. Build and run on a simulator to confirm the icon appears correctly

---

## Step 4 — Create App Record in App Store Connect

1. Go to **https://appstoreconnect.apple.com**
2. Click **My Apps** → **+** → **New App**
3. Fill in:
   - Platform: iOS
   - Name: `Nihongo News`
   - Primary Language: English
   - Bundle ID: select the one you set in Step 2 (must match exactly)
   - SKU: `nihongo-news-001` (any unique string)
4. Click **Create**

---

## Step 5 — Fill In App Information

In App Store Connect, under your app → **App Information**:

| Field | Value |
|---|---|
| Name | Nihongo News |
| Subtitle | Learn Japanese via Real News |
| Primary Category | Education |
| Secondary Category | News |
| Content Rights | No third-party content |
| Age Rating | 4+ |

---

## Step 6 — Fill In Version Details (1.0 Prepare for Submission)

Under **iOS App → 1.0 Prepare for Submission**:

### Screenshots
Upload from `AppStoreAssets/screenshots-1.4-gemini/` in this order (final set = Gemini version, chosen 2026-11-11; replaces the old 5 mockups — delete those in App Store Connect first):
1. `01_feed.png` — Learn Japanese from today's news
2. `02_word.png` — Tap any word you don't know
3. `03_sentence.png` — Write it. Get it corrected.
4. `04_listen.png` — Hear every sentence (NEW in 1.4)
5. `05_quiz.png` — Quizzes on what you just read
6. `06_vocab.png` — Every word you learn, tracked

Rebuild after app changes (from AppStoreAssets/screenshot-tool): `python3 compose_gemini.py raw ../screenshots-1.4-gemini`
(Old mockups in `AppStoreAssets/screenshots/`, the drawn alternative in `screenshots-1.4/` — both for reference only.)

Device slot: **6.7-inch Display** (covers all required sizes for new apps)

> Note: If App Store Connect also asks for 6.9" you can upload the same images — they scale fine.

### Description
Copy from `AppStoreAssets/metadata.md` → Description section.

### Keywords
```
Japanese,JLPT,learn Japanese,romaji,kanji,hiragana,news,vocabulary,N3,N4,N5
```

### Support URL
```
https://github.com/AndyJakob78/japanese-tutor
```

### Privacy Policy URL
```
https://andyjakob78.github.io/japanese-tutor/privacy-policy.html
```

### What's New
```
Initial release. Generate Japanese learning articles from today's real news, tailored to your JLPT level.
```

---

## Step 7 — App Privacy (Data Declaration)

In App Store Connect → **App Privacy**:

- Click "Get Started"
- **Data types collected**: select **Device ID** (used for account identification)
- Purpose: App Functionality
- Linked to user: **No**
- Used for tracking: **No**

This matches the privacy policy you already wrote.

---

## Step 8 — Build and Upload via Xcode

Make sure your backend is deployed and working, then:

```bash
# In your project directory — bump the build number
agvtool next-version -all

# Archive and upload (replace with your real team ID / provisioning profile)
xcodebuild archive \
  -project JapaneseTutor/JapaneseTutor.xcodeproj \
  -scheme JapaneseTutor \
  -configuration Release \
  -archivePath /tmp/NihongoNews.xcarchive

xcodebuild -exportArchive \
  -archivePath /tmp/NihongoNews.xcarchive \
  -exportOptionsPlist /tmp/ExportOptions.plist \
  -exportPath /tmp/NihongoNewsExport
```

Or use **Xcode → Product → Archive → Distribute App → App Store Connect → Upload**.

---

## Step 9 — Submit for Review

1. In App Store Connect → your app → **1.0 Prepare for Submission**
2. Confirm all sections have green checkmarks
3. Under **Build**, select the uploaded build
4. Click **Add for Review** → **Submit to App Review**

Review typically takes 1–3 days for a new app.

---

## Checklist Summary

- [ ] GitHub Pages live with privacy policy
- [ ] Bundle ID updated in Xcode
- [ ] Display name set to "Nihongo News"
- [ ] App record created in App Store Connect
- [ ] App name, subtitle, description, keywords filled in
- [ ] 5 screenshots uploaded
- [ ] Support URL + Privacy Policy URL entered
- [ ] App Privacy data declaration completed
- [ ] Build uploaded from Xcode
- [ ] Submitted for review
