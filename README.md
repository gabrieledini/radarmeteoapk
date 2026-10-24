# Radar Meteo

Radar previsionale di nuvole e pioggia sull'Europa (6 ore passate + 72 ore di previsione, frame ogni 10 minuti)
con dati [Open-Meteo](https://open-meteo.com), mappa Esri Dark Gray e Leaflet. Impacchettato come app Android con
[Capacitor](https://capacitorjs.com); l'APK viene compilato da GitHub Actions.

## Struttura

```
www/                  app web (è ciò che finisce nell'APK)
  index.html
  css/app.css
  js/app.js
  icon.svg            icona sorgente (app, splash, PWA)
scripts/
  copy-vendor.mjs     copia Leaflet in www/vendor (niente CDN all'avvio)
  make-icons.mjs      genera i PNG sorgente per @capacitor/assets
  patch-android.mjs   permessi posizione + versionCode/versionName
capacitor.config.json appId, nome app, colori
.github/workflows/android.yml   build dell'APK
```

La cartella `android/` non è versionata: la Action la rigenera a ogni build con `npx cap add android`.
Se in futuro serve personalizzare il codice nativo, generala in locale, togli `android/` da `.gitignore`
e committala: la Action la userà così com'è.

## Ottenere l'APK

1. Fai push su `main` (oppure lancia a mano *Actions → Build APK Android → Run workflow*).
2. A build finita, apri la run e scarica l'artifact `radar-meteo-<versione>` (zip con l'APK).
3. Per una release pubblica: crea un tag `v1.0.0` e fai push del tag; l'APK viene allegato a una GitHub Release.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

### APK firmato (consigliato)

L'APK *debug* è firmato con una chiave diversa a ogni build: per installare una nuova versione bisogna prima
disinstallare quella vecchia. Con una chiave di release fissa gli aggiornamenti si installano sopra.

```bash
keytool -genkeypair -v -keystore radar.jks -alias radar -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 radar.jks > radar.jks.b64    # su Windows: certutil -encode radar.jks radar.jks.b64 (togli le righe BEGIN/END)
```

In *Settings → Secrets and variables → Actions* aggiungi:

| Secret | Valore |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | contenuto di `radar.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | password del keystore |
| `ANDROID_KEY_ALIAS` | `radar` |
| `ANDROID_KEY_PASSWORD` | password della chiave |

Da quel momento la Action produce anche `radar-meteo-<versione>.apk` firmato. Conserva `radar.jks` al sicuro:
se lo perdi non potrai più aggiornare l'app installata.

## Sviluppo in locale

Serve Node 20+ (Capacitor 7). Per provare la pagina basta servire `www/` con un qualsiasi server statico;
senza `npm run build` Leaflet viene caricato dalla CDN.

```bash
npm install
npm run build          # copia Leaflet in www/vendor
npx cap add android    # solo la prima volta (richiede Android SDK + JDK 21 per compilare)
npm run patch:android
npm run icons
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Note

- Open-Meteo gratuito ha un limite di circa 600 punti/minuto: ogni aggiornamento ne scarica 572, quindi
  premere ⟳ più volte di fila può dare `HTTP 429`. I dati restano in cache per 4 ore.
- Per cambiare identificativo dell'app modifica `appId` in `capacitor.config.json` *prima* della prima release.
