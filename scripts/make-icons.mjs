// Genera i PNG sorgente per @capacitor/assets partendo da www/icon.svg.
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets');
const BG = '#0f1d28';
mkdirSync(out, { recursive: true });

const svg = readFileSync(join(root, 'www', 'icon.svg'), 'utf8');
// primo piano dell'icona adattiva: senza sfondo e ridotto nella zona sicura (66%)
const foreground = svg
  .replace(/<rect id="bg"[^>]*\/>/, '')
  .replace(/(<svg[^>]*>)/, '$1<g transform="translate(256 256) scale(.62) translate(-256 -256)">')
  .replace(/<\/svg>\s*$/, '</g></svg>');
// icona intera a pieno formato (bordi squadrati: Android applica la propria maschera)
const square = svg.replace(/rx="112"/, 'rx="0"');

const render = (s, size) => sharp(Buffer.from(s), { density: 384 }).resize(size, size);
const splash = async (file) => {
  const logo = await render(square, 600).png().toBuffer();
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: 'center' }]).png().toFile(join(out, file));
};

await render(square, 1024).png().toFile(join(out, 'icon-only.png'));
await render(foreground, 1024).png().toFile(join(out, 'icon-foreground.png'));
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: BG } }).png().toFile(join(out, 'icon-background.png'));
await splash('splash.png');
await splash('splash-dark.png');
console.log('Icone sorgente generate in', out);
