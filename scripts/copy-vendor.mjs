// Copia Leaflet da node_modules in www/vendor, così l'app non dipende dalla CDN all'avvio.
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', 'leaflet', 'dist');
const dst = join(root, 'www', 'vendor', 'leaflet');

mkdirSync(dst, { recursive: true });
for (const f of ['leaflet.js', 'leaflet.css', 'images']) cpSync(join(src, f), join(dst, f), { recursive: true });
console.log('Leaflet copiato in', dst);
