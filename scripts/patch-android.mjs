// Adatta il progetto Android generato da "cap add android":
// - permessi di posizione (per il pulsante "Usa la mia posizione")
// - versionCode / versionName da variabili d'ambiente (impostate dalla GitHub Action)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = join(root, 'android', 'app', 'build.gradle');
if (!existsSync(manifestPath)) {
  console.error('Progetto android/ assente: esegui prima "npx cap add android".');
  process.exit(1);
}

let manifest = readFileSync(manifestPath, 'utf8');
for (const p of ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION']) {
  const tag = `<uses-permission android:name="android.permission.${p}" />`;
  if (!manifest.includes(`android.permission.${p}`)) manifest = manifest.replace('</manifest>', `    ${tag}\n</manifest>`);
}
writeFileSync(manifestPath, manifest);

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const versionCode = parseInt(process.env.VERSION_CODE || '1', 10);
const versionName = process.env.VERSION_NAME || pkg.version;
let gradle = readFileSync(gradlePath, 'utf8');
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`);
writeFileSync(gradlePath, gradle);

console.log(`Android aggiornato: versionCode ${versionCode}, versionName ${versionName}, permessi posizione ok`);
