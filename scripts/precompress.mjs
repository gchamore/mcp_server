/**
 * Précompression des fichiers statiques.
 *
 * Compresser à la volée à chaque requête, c'est payer le même calcul des
 * milliers de fois pour un fichier qui ne change jamais — les assets de Vite
 * sont hachés, donc immuables par construction. On compresse donc une fois, au
 * plus haut niveau de qualité (brotli 11, autrement trop lent en ligne), et le
 * serveur se contente de servir le bon fichier selon l'en-tête `Accept-Encoding`.
 *
 * Les formats déjà compressés (woff2, png, jpg, webp) sont ignorés : les
 * recompresser gonfle le dépôt sans rien gagner.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

const ROOT = path.resolve(import.meta.dirname, '..', 'web', 'dist');
const COMPRESSIBLE = new Set([
  '.js',
  '.css',
  '.html',
  '.svg',
  '.json',
  '.txt',
  '.xml',
  '.webmanifest',
]);

/** En dessous de ce seuil, l'en-tête de compression coûte plus qu'il ne rapporte. */
const MIN_BYTES = 1024;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

const report = [];

for await (const file of walk(ROOT)) {
  if (file.endsWith('.br') || file.endsWith('.gz')) continue;
  if (!COMPRESSIBLE.has(path.extname(file))) continue;

  const { size } = await stat(file);
  if (size < MIN_BYTES) continue;

  const raw = await readFile(file);

  const [br, gzipped] = await Promise.all([
    brotli(raw, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    }),
    gz(raw, { level: 9 }),
  ]);

  await Promise.all([writeFile(`${file}.br`, br), writeFile(`${file}.gz`, gzipped)]);
  report.push({ file: path.relative(ROOT, file), raw: raw.length, br: br.length });
}

report.sort((a, b) => b.raw - a.raw);

const totalRaw = report.reduce((sum, r) => sum + r.raw, 0);
const totalBr = report.reduce((sum, r) => sum + r.br, 0);

for (const { file, raw, br } of report.slice(0, 6)) {
  console.log(`  ${file.padEnd(34)} ${String(raw).padStart(7)} → ${String(br).padStart(6)} o`);
}
if (report.length > 6) console.log(`  … et ${report.length - 6} autres fichiers`);
console.log(
  `  total ${totalRaw} → ${totalBr} o en brotli (-${Math.round(100 - (totalBr / totalRaw) * 100)} %)`,
);

/**
 * Empreinte du lot, écrite pour que le serveur puisse vérifier au démarrage
 * que les fichiers `.br` correspondent bien au build servi.
 */
const digest = createHash('sha256')
  .update(report.map((r) => `${r.file}:${r.br}`).join('\n'))
  .digest('hex');
await writeFile(path.join(ROOT, '.precompressed'), `${digest}\n`);
