import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, "..");
const publicDir = join(projectRoot, "public");
const buildIconsDir = join(projectRoot, "build", "icons");

const lightPalette = {
  backgroundStart: "#F7FAFF",
  backgroundEnd: "#E7EEF9",
  panel: "#16213B",
  panelShadow: "#0B1220",
  playStart: "#58D7FF",
  playEnd: "#2E8BFF",
  line: "#F2F7FF",
  accent: "#7CE4C3",
};

const darkPalette = {
  backgroundStart: "#0B132B",
  backgroundEnd: "#162A56",
  panel: "#EEF4FF",
  panelShadow: "#08101D",
  playStart: "#64F0D5",
  playEnd: "#4E8DFF",
  line: "#15213E",
  accent: "#8CEBFF",
};

const createSvg = (palette) => `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="168" y1="128" x2="864" y2="904" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.backgroundStart}" />
      <stop offset="1" stop-color="${palette.backgroundEnd}" />
    </linearGradient>
    <linearGradient id="play" x1="320" y1="332" x2="572" y2="700" gradientUnits="userSpaceOnUse">
      <stop stop-color="${palette.playStart}" />
      <stop offset="1" stop-color="${palette.playEnd}" />
    </linearGradient>
    <filter id="shadow" x="120" y="132" width="784" height="760" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feFlood flood-opacity="0" result="BackgroundImageFix"/>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
      <feOffset dy="18"/>
      <feGaussianBlur stdDeviation="28"/>
      <feComposite in2="hardAlpha" operator="out"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.0235294 0 0 0 0 0.0509804 0 0 0 0 0.105882 0 0 0 0.18 0"/>
      <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_2"/>
      <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1_2" result="shape"/>
    </filter>
  </defs>
  <rect x="96" y="96" width="832" height="832" rx="220" fill="url(#bg)"/>
  <circle cx="776" cy="256" r="34" fill="${palette.accent}" fill-opacity="0.95"/>
  <g filter="url(#shadow)">
    <rect x="184" y="188" width="656" height="648" rx="160" fill="${palette.panel}"/>
    <rect x="224" y="228" width="576" height="568" rx="128" fill="${palette.panel}" fill-opacity="0.94"/>
    <path d="M382 332.5C382 313.28 403.533 301.833 419.5 312.637L604.778 438.077C619.003 447.705 619.122 468.649 605.007 478.438L419.729 606.966C403.799 618.017 382 606.621 382 587.244V332.5Z" fill="url(#play)"/>
    <rect x="612" y="360" width="100" height="34" rx="17" fill="${palette.line}" />
    <rect x="612" y="448" width="124" height="34" rx="17" fill="${palette.line}" fill-opacity="0.94" />
    <rect x="612" y="536" width="88" height="34" rx="17" fill="${palette.line}" fill-opacity="0.86" />
    <rect x="286" y="676" width="452" height="22" rx="11" fill="${palette.line}" fill-opacity="0.2"/>
  </g>
</svg>
`;

const createAdaptiveSvg = () => `
<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    :root {
      --background-start: ${lightPalette.backgroundStart};
      --background-end: ${lightPalette.backgroundEnd};
      --panel: ${lightPalette.panel};
      --play-start: ${lightPalette.playStart};
      --play-end: ${lightPalette.playEnd};
      --line: ${lightPalette.line};
      --accent: ${lightPalette.accent};
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --background-start: ${darkPalette.backgroundStart};
        --background-end: ${darkPalette.backgroundEnd};
        --panel: ${darkPalette.panel};
        --play-start: ${darkPalette.playStart};
        --play-end: ${darkPalette.playEnd};
        --line: ${darkPalette.line};
        --accent: ${darkPalette.accent};
      }
    }
  </style>
  <defs>
    <linearGradient id="bg" x1="168" y1="128" x2="864" y2="904" gradientUnits="userSpaceOnUse">
      <stop stop-color="var(--background-start)" />
      <stop offset="1" stop-color="var(--background-end)" />
    </linearGradient>
    <linearGradient id="play" x1="320" y1="332" x2="572" y2="700" gradientUnits="userSpaceOnUse">
      <stop stop-color="var(--play-start)" />
      <stop offset="1" stop-color="var(--play-end)" />
    </linearGradient>
  </defs>
  <rect x="96" y="96" width="832" height="832" rx="220" fill="url(#bg)"/>
  <circle cx="776" cy="256" r="34" fill="var(--accent)" fill-opacity="0.95"/>
  <rect x="184" y="188" width="656" height="648" rx="160" fill="var(--panel)"/>
  <rect x="224" y="228" width="576" height="568" rx="128" fill="var(--panel)" fill-opacity="0.94"/>
  <path d="M382 332.5C382 313.28 403.533 301.833 419.5 312.637L604.778 438.077C619.003 447.705 619.122 468.649 605.007 478.438L419.729 606.966C403.799 618.017 382 606.621 382 587.244V332.5Z" fill="url(#play)"/>
  <rect x="612" y="360" width="100" height="34" rx="17" fill="var(--line)" />
  <rect x="612" y="448" width="124" height="34" rx="17" fill="var(--line)" fill-opacity="0.94" />
  <rect x="612" y="536" width="88" height="34" rx="17" fill="var(--line)" fill-opacity="0.86" />
  <rect x="286" y="676" width="452" height="22" rx="11" fill="var(--line)" fill-opacity="0.2"/>
</svg>
`;

const writePng = async (svg, outputPath, size) => {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(outputPath);
};

const writeIco = (pngPath, outputPath) => {
  const pngBuffer = readFileSync(pngPath);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);

  writeFileSync(outputPath, Buffer.concat([header, entry, pngBuffer]));
};

mkdirSync(publicDir, { recursive: true });
mkdirSync(buildIconsDir, { recursive: true });
rmSync(join(buildIconsDir, "icon-master.png"), { force: true });
rmSync(join(buildIconsDir, "icon-source.svg"), { force: true });
rmSync(join(buildIconsDir, "icon.iconset"), { recursive: true, force: true });

const adaptiveSvg = createAdaptiveSvg();
const darkSvg = createSvg(darkPalette);
const lightSvg = createSvg(lightPalette);

writeFileSync(join(publicDir, "icon.svg"), adaptiveSvg);
writeFileSync(join(publicDir, "assets", "app-icon-dark.svg"), darkSvg);
writeFileSync(join(publicDir, "assets", "app-icon-light.svg"), lightSvg);

await writePng(darkSvg, join(publicDir, "apple-icon.png"), 180);
await writePng(lightSvg, join(publicDir, "icon-light-32x32.png"), 32);
await writePng(darkSvg, join(publicDir, "icon-dark-32x32.png"), 32);

await writePng(darkSvg, join(buildIconsDir, "icon.png"), 512);
await writePng(darkSvg, join(buildIconsDir, "icon-256.png"), 256);
writeIco(join(buildIconsDir, "icon-256.png"), join(buildIconsDir, "icon.ico"));

console.log("Generated application icons.");
