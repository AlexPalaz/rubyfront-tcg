// Gli sfondi della home, ottimizzati per il web.
//
//   node scripts/home-art.mjs <sorgente.png> <nome>
//
// Dalla sorgente (l'upscale di Midjourney, 2912×1632, o l'originale 1456×816)
// escono due JPEG in public/home/: <nome>.jpg per gli schermi normali (alto
// al massimo 1080px: la carta della home arriva a ~1000px) e <nome>@2x.jpg
// per i Retina (alto al massimo 2160px). Il client sceglie con image-set().
// Qualità 78 e 70: il 2x è grande il quadruplo, e su Retina la compressione
// si vede meno. Usa sips (macOS), come build-catalog.mjs per le carte.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [source, name] = process.argv.slice(2);
if (!source || !name) {
  console.error("uso: node scripts/home-art.mjs <sorgente.png> <nome>");
  process.exit(1);
}

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../public/home");
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { suffix: "", height: 1080, quality: "78" },
  { suffix: "@2x", height: 2160, quality: "70" },
];

const height = parseInt(execFileSync("sips", ["-g", "pixelHeight", source], { encoding: "utf8" }).match(/pixelHeight: (\d+)/)?.[1] ?? "0", 10);

// Se la sorgente non supera il 1x (l'originale 1456×816, senza upscale), il
// 2x è lo stesso file: il client lo chiede comunque sui Retina, e una copia
// più compressa dello stesso quadro sarebbe solo peggiore.
const [oneX] = SIZES;
for (const size of SIZES) {
  const to = join(OUT, `${name}${size.suffix}.jpg`);
  if (size !== oneX && height <= oneX.height) {
    copyFileSync(join(OUT, `${name}${oneX.suffix}.jpg`), to);
  } else {
    const args = ["-s", "format", "jpeg", "-s", "formatOptions", size.quality];
    if (height > size.height) args.push("--resampleHeight", String(size.height));
    execFileSync("sips", [...args, source, "--out", to], { stdio: "ignore" });
  }
  const kb = Math.round(statSync(to).size / 1024);
  const h = Math.min(height, size.height);
  console.log(`${basename(to)}  ${h}px alto  ${kb} KB`);
}
