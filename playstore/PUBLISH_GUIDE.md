# VORTEX - Google Play Store Publishing Guide

## Pre-Requisites (You Need To Do These)

### 1. Google Play Developer Account
- Go to https://play.google.com/console
- Pay the one-time $25 registration fee
- Complete identity verification

### 2. Install Android Development Tools
Run these commands on your machine:

```bash
# Install Chocolatey (if not already installed) - run PowerShell as Admin
Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install JDK 17 and Android Studio
choco install temurin17 -y
choco install androidstudio -y
```

After installing Android Studio:
1. Open Android Studio
2. Go to SDK Manager (Settings > Android SDK)
3. Install Android SDK 34 (Android 14)
4. Install Android SDK Build-Tools 34
5. Install Android SDK Command-line Tools
6. Note the SDK path (usually `C:\Users\<you>\AppData\Local\Android\Sdk`)

Set environment variables (PowerShell as Admin):
```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Eclipse Adoptium\jdk-17...", "User")
```

---

## Build Steps

### 3. Add Android Platform
```bash
cd C:\Users\prane\claude\simplegames\vortex
npx cap add android
npx cap sync android
```

### 4. Generate a Signing Key
You need a keystore to sign the release build. **Keep this file safe — you cannot update the app without it!**

```bash
keytool -genkey -v -keystore vortex-release.keystore -alias vortex -keyalg RSA -keysize 2048 -validity 10000
```
- Remember the passwords you set!
- Store the keystore file securely (NOT in git)

### 5. Build Release AAB (Android App Bundle)
Open the Android project in Android Studio:
```bash
npx cap open android
```

In Android Studio:
1. Build > Generate Signed Bundle / APK
2. Choose "Android App Bundle"
3. Select your keystore file
4. Enter passwords and alias
5. Choose "release" build variant
6. Click "Create"

The AAB will be at: `android/app/release/app-release.aab`

---

## CRITICAL: Google Play Billing Requirement

**Google Play policy requires using Google Play Billing for in-app digital purchases.**

Your app currently uses Stripe for coin purchases. For the Play Store version, you MUST either:

**Option A: Replace Stripe with Google Play Billing (Recommended)**
- Use `@anthropic/capacitor-google-play-billing` or `cordova-plugin-purchase`
- Google takes a 15% cut (first $1M revenue) or 30% after that
- This is the only way Google will approve your app

**Option B: Remove In-App Purchases from Play Store version**
- Remove the coin purchase UI from the Android build
- Keep coins as earn-only through gameplay
- Simplest approach to get approved quickly

**Option C: Use Stripe for physical goods/services only**
- Stripe can ONLY be used for physical goods or services consumed outside the app
- Cosmetic skins/coins are digital goods — Stripe is NOT allowed

**Recommendation**: Start with Option B to get the app published quickly, then add Google Play Billing later.

---

## Play Store Submission

### 6. Create App in Google Play Console
1. Go to https://play.google.com/console
2. Click "Create app"
3. Fill in:
   - App name: **VORTEX: Cosmic Arena**
   - Default language: English (United States)
   - App type: Game
   - Free or paid: Free

### 7. Store Listing
Use the content from `playstore/listing.md`:
- Short description (80 chars)
- Full description (4000 chars)
- App icon: Use `public/icons/icon-512.png` (must be 512x512 PNG)
- Feature graphic: Need to create (1024x500 PNG) — see Asset Requirements below
- Screenshots: Need at least 2 phone screenshots (min 320px, max 3840px)
  - You already have `screenshot-wide.png` and `screenshot-narrow.png`

### 8. Asset Requirements
You still need to create:
- [ ] **Feature Graphic**: 1024x500 PNG (promotional banner shown on Play Store)
- [ ] **Phone Screenshots**: At least 2, recommended 4-8 (1080x1920 or similar)
- [ ] **7-inch Tablet Screenshots**: Optional but recommended (min 2)
- [ ] **10-inch Tablet Screenshots**: Optional but recommended (min 2)

Tips for screenshots:
- Run the game in Chrome DevTools mobile mode
- Take screenshots during gameplay showing the arena, menus, skins shop
- Add text overlays like "Real-time Multiplayer" or "12 Unique Skins"

### 9. Content Rating
Fill out the IARC questionnaire:
- Violence: No realistic violence (abstract orbs)
- User interaction: Yes (multiplayer)
- In-app purchases: Yes (if keeping them)
- Data sharing: Minimal
- Expected rating: **Everyone** or **Everyone 10+**

### 10. Privacy & Data Safety
- Privacy policy URL: `https://<your-railway-domain>/privacy.html`
  - Make sure the server is deployed and privacy page is accessible
- Data safety form:
  - Data collected: Username, email (optional), gameplay stats
  - Data shared: None
  - Data encrypted in transit: Yes (HTTPS/WSS)
  - Users can request data deletion: Yes

### 11. Upload AAB & Release
1. Go to Production > Create new release
2. Upload the `.aab` file
3. Add release notes (e.g., "Initial release of VORTEX: Cosmic Arena")
4. Review and submit

### 12. Review Timeline
- Google typically reviews apps within 1-7 days
- First-time submissions may take longer
- You'll get an email when approved or if changes are needed

---

## Post-Launch Checklist
- [ ] Monitor crash reports in Play Console
- [ ] Respond to user reviews
- [ ] Set up Firebase Crashlytics for better crash reporting
- [ ] Consider adding Google Play Games Services for achievements
- [ ] Add Google Play Billing if you want in-app purchases
