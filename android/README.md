# Web-Archivierer – Android-App

Native Android-App (Kotlin, Jetpack Compose, Material 3) für den Web-Archivierer-Server. Gleiche REST-API wie die Weboberfläche
(siehe [`../docs/ANDROID.md`](../docs/ANDROID.md)), Optik wie die Google-Apps: Material You (dynamische Farben ab Android 12, sonst Indigo),
Hell/Dunkel nach System.

## Funktionen

- **Login** in zwei Schritten (Server → Zugangsdaten), Ersteinrichtung (erster Benutzer wird Admin), Token-Refresh im Hintergrund
- **Archivliste** mit Suche, Filter-Chips (Alle/Fertig/Läuft/Fehler), Pull-to-Refresh, Live-Fortschritt laufender Archivierungen
- **Hinzufügen:** URL → *Live öffnen* (Proxy) oder *Archivieren* (optional ohne JavaScript)
- **Teilen-Ziel:** In jedem Browser „Teilen → Web-Archivierer“ öffnet den Hinzufügen-Dialog mit dem Link
- **Live-Viewer:** Adressleiste, Vor/Zurück/Neu laden, „Diese Seite archivieren“, Link kopieren/im Browser öffnen
- **Archiv-Viewer** (offline-Stand vom Server), **Export als PDF oder ZIP** in „Downloads“ (PDF nur, wenn der Server Chromium hat)
- Umbenennen, Löschen, Erneut versuchen; Konto (Name/Passwort), Benutzerverwaltung für Admins

Voreingestellter Server: `https://archive.host-1.pi.frontend.conner.api64.de` (im Login änderbar; auch `http://192.168.x.x:3000` im Heimnetz möglich).

## APK installieren

Fertige Debug-APK: [`apk/web-archiver-debug.apk`](apk/web-archiver-debug.apk) (Android 10+).
Aufs Handy kopieren (USB, Cloud, Mail …) und öffnen – ggf. „Installation aus dieser Quelle erlauben“ bestätigen.
Oder per USB-Debugging: `adb install -r apk/web-archiver-debug.apk`.

Die APK ist mit dem im Repo liegenden Debug-Schlüssel signiert (`app/debug.keystore`): Neuere Builds lassen sich über eine
installierte Version drüberinstallieren, ohne dass Daten verloren gehen.

## Selbst bauen

Voraussetzungen: JDK 17+ und Android SDK (Plattform 36, Build-Tools 36). Am einfachsten mit Android Studio („Open“ auf `android/`).

```bash
cd android
echo "sdk.dir=$HOME/Android/Sdk" > local.properties     # Pfad zum Android SDK
./gradlew assembleDebug                                  # → app/build/outputs/apk/debug/app-debug.apk
./gradlew testDebugUnitTest                              # Tests + Screenshots nach app/build/screenshots/
```

Die Tests laufen ohne Gerät/Emulator (Robolectric): API-Client inkl. Token-Refresh gegen einen Fake-Server und der komplette
UI-Ablauf Login → Liste → Hinzufügen → Konto → Abmelden mit Screenshots.

## Aufbau

```
app/src/main/java/app/webarchiver
├─ data/   Models, ApiClient (OkHttp, Refresh-Mutex), SessionStore (app-privat, kein Backup)
├─ ui/     AppNav, login/, home/, viewer/ (WebView), account/, theme/ (Material 3)
└─ util/   Formatierung, Export nach „Downloads“ (MediaStore), Teilen
```

Sicherheit: Tokens liegen im app-privaten Speicher (`allowBackup=false`). Klartext-HTTP ist erlaubt, damit ein Server im Heimnetz
funktioniert – für Zugriff über das Internet immer HTTPS verwenden. Die WebView lässt nur `/proxy/…` und `/archive/…` des eigenen Servers zu;
alle anderen Links öffnen im System-Browser.
