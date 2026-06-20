/**
 * Bundled designer fonts (self-hosted via @fontsource, so they work offline and
 * their files are available for outlining/embedding on export). Importing each
 * stylesheet registers its @font-face; the FONTS list drives the font picker.
 *
 * v1 loads the regular (400) weight of every family — real bold/italic weights
 * are a follow-up; the browser synthesizes them for now.
 */

import '@fontsource/roboto/latin-400.css';
import '@fontsource/open-sans/latin-400.css';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/lato/latin-400.css';
import '@fontsource/poppins/latin-400.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/raleway/latin-400.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/roboto-condensed/latin-400.css';
import '@fontsource/source-sans-3/latin-400.css';
import '@fontsource/work-sans/latin-400.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/quicksand/latin-400.css';
import '@fontsource/josefin-sans/latin-400.css';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/barlow/latin-400.css';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/playfair-display/latin-400.css';
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/libre-baskerville/latin-400.css';
import '@fontsource/pt-serif/latin-400.css';
import '@fontsource/oswald/latin-400.css';
import '@fontsource/bebas-neue/latin-400.css';
import '@fontsource/anton/latin-400.css';
import '@fontsource/lobster/latin-400.css';
import '@fontsource/dancing-script/latin-400.css';
import '@fontsource/pacifico/latin-400.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/roboto-mono/latin-400.css';

// Raw .woff (WOFF1) URLs for each family — used to outline text (opentype.js) or
// embed the font in an exported SVG. opentype.js parses WOFF1 but not WOFF2, so we
// deliberately import the .woff (not .woff2) files here.
import * as opentype from 'opentype.js';
import uRoboto from '@fontsource/roboto/files/roboto-latin-400-normal.woff?url';
import uOpenSans from '@fontsource/open-sans/files/open-sans-latin-400-normal.woff?url';
import uMontserrat from '@fontsource/montserrat/files/montserrat-latin-400-normal.woff?url';
import uLato from '@fontsource/lato/files/lato-latin-400-normal.woff?url';
import uPoppins from '@fontsource/poppins/files/poppins-latin-400-normal.woff?url';
import uInter from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import uRaleway from '@fontsource/raleway/files/raleway-latin-400-normal.woff?url';
import uNunito from '@fontsource/nunito/files/nunito-latin-400-normal.woff?url';
import uRobotoCondensed from '@fontsource/roboto-condensed/files/roboto-condensed-latin-400-normal.woff?url';
import uSourceSans3 from '@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff?url';
import uWorkSans from '@fontsource/work-sans/files/work-sans-latin-400-normal.woff?url';
import uRubik from '@fontsource/rubik/files/rubik-latin-400-normal.woff?url';
import uQuicksand from '@fontsource/quicksand/files/quicksand-latin-400-normal.woff?url';
import uJosefinSans from '@fontsource/josefin-sans/files/josefin-sans-latin-400-normal.woff?url';
import uArchivo from '@fontsource/archivo/files/archivo-latin-400-normal.woff?url';
import uBarlow from '@fontsource/barlow/files/barlow-latin-400-normal.woff?url';
import uDmSans from '@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff?url';
import uSpaceGrotesk from '@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff?url';
import uPlayfairDisplay from '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff?url';
import uMerriweather from '@fontsource/merriweather/files/merriweather-latin-400-normal.woff?url';
import uLibreBaskerville from '@fontsource/libre-baskerville/files/libre-baskerville-latin-400-normal.woff?url';
import uPtSerif from '@fontsource/pt-serif/files/pt-serif-latin-400-normal.woff?url';
import uOswald from '@fontsource/oswald/files/oswald-latin-400-normal.woff?url';
import uBebasNeue from '@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url';
import uAnton from '@fontsource/anton/files/anton-latin-400-normal.woff?url';
import uLobster from '@fontsource/lobster/files/lobster-latin-400-normal.woff?url';
import uDancingScript from '@fontsource/dancing-script/files/dancing-script-latin-400-normal.woff?url';
import uPacifico from '@fontsource/pacifico/files/pacifico-latin-400-normal.woff?url';
import uCaveat from '@fontsource/caveat/files/caveat-latin-400-normal.woff?url';
import uRobotoMono from '@fontsource/roboto-mono/files/roboto-mono-latin-400-normal.woff?url';

export type FontCategory = 'Sans Serif' | 'Serif' | 'Display' | 'Handwriting' | 'Monospace';

export interface FontDef {
  /** Must match the @font-face family name @fontsource registers. */
  family: string;
  category: FontCategory;
}

export const FONTS: FontDef[] = [
  // Sans Serif
  { family: 'Roboto', category: 'Sans Serif' },
  { family: 'Open Sans', category: 'Sans Serif' },
  { family: 'Inter', category: 'Sans Serif' },
  { family: 'Montserrat', category: 'Sans Serif' },
  { family: 'Poppins', category: 'Sans Serif' },
  { family: 'Lato', category: 'Sans Serif' },
  { family: 'Raleway', category: 'Sans Serif' },
  { family: 'Nunito', category: 'Sans Serif' },
  { family: 'Work Sans', category: 'Sans Serif' },
  { family: 'Source Sans 3', category: 'Sans Serif' },
  { family: 'Rubik', category: 'Sans Serif' },
  { family: 'DM Sans', category: 'Sans Serif' },
  { family: 'Space Grotesk', category: 'Sans Serif' },
  { family: 'Archivo', category: 'Sans Serif' },
  { family: 'Barlow', category: 'Sans Serif' },
  { family: 'Quicksand', category: 'Sans Serif' },
  { family: 'Josefin Sans', category: 'Sans Serif' },
  { family: 'Roboto Condensed', category: 'Sans Serif' },
  // Serif
  { family: 'Playfair Display', category: 'Serif' },
  { family: 'Merriweather', category: 'Serif' },
  { family: 'Libre Baskerville', category: 'Serif' },
  { family: 'PT Serif', category: 'Serif' },
  // Display
  { family: 'Oswald', category: 'Display' },
  { family: 'Bebas Neue', category: 'Display' },
  { family: 'Anton', category: 'Display' },
  { family: 'Lobster', category: 'Display' },
  // Handwriting
  { family: 'Dancing Script', category: 'Handwriting' },
  { family: 'Pacifico', category: 'Handwriting' },
  { family: 'Caveat', category: 'Handwriting' },
  // Monospace
  { family: 'Roboto Mono', category: 'Monospace' },
];

const SYSTEM_FONTS = ['Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New'];
const CATEGORY_ORDER: FontCategory[] = ['Sans Serif', 'Serif', 'Display', 'Handwriting', 'Monospace'];

/** Populate a <select> with the system fonts + bundled fonts, grouped, each option previewed in its own face. */
export function populateFontSelect(select: HTMLSelectElement): void {
  select.innerHTML = '';

  const sys = document.createElement('optgroup');
  sys.label = 'System';
  for (const f of SYSTEM_FONTS) {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = f;
    o.style.fontFamily = f;
    sys.appendChild(o);
  }
  select.appendChild(sys);

  for (const cat of CATEGORY_ORDER) {
    const og = document.createElement('optgroup');
    og.label = cat;
    for (const f of FONTS.filter(x => x.category === cat)) {
      const o = document.createElement('option');
      o.value = f.family;
      o.textContent = f.family;
      o.style.fontFamily = `'${f.family}'`;
      og.appendChild(o);
    }
    select.appendChild(og);
  }
}

/** Bundled WOFF1 file URL for each family, for outlining/embedding on export. */
const FONT_FILES: Record<string, string> = {
  'Roboto': uRoboto,
  'Open Sans': uOpenSans,
  'Montserrat': uMontserrat,
  'Lato': uLato,
  'Poppins': uPoppins,
  'Inter': uInter,
  'Raleway': uRaleway,
  'Nunito': uNunito,
  'Roboto Condensed': uRobotoCondensed,
  'Source Sans 3': uSourceSans3,
  'Work Sans': uWorkSans,
  'Rubik': uRubik,
  'Quicksand': uQuicksand,
  'Josefin Sans': uJosefinSans,
  'Archivo': uArchivo,
  'Barlow': uBarlow,
  'DM Sans': uDmSans,
  'Space Grotesk': uSpaceGrotesk,
  'Playfair Display': uPlayfairDisplay,
  'Merriweather': uMerriweather,
  'Libre Baskerville': uLibreBaskerville,
  'PT Serif': uPtSerif,
  'Oswald': uOswald,
  'Bebas Neue': uBebasNeue,
  'Anton': uAnton,
  'Lobster': uLobster,
  'Dancing Script': uDancingScript,
  'Pacifico': uPacifico,
  'Caveat': uCaveat,
  'Roboto Mono': uRobotoMono,
};

/** Map common system / generic font names to the nearest bundled family for outlining. */
const SYSTEM_FALLBACK: Record<string, string> = {
  'arial': 'Roboto',
  'helvetica': 'Roboto',
  'sans-serif': 'Roboto',
  'georgia': 'PT Serif',
  'times': 'PT Serif',
  'times new roman': 'PT Serif',
  'serif': 'PT Serif',
  'courier': 'Roboto Mono',
  'courier new': 'Roboto Mono',
  'monospace': 'Roboto Mono',
};

/** Resolve a font-family value to a bundled family name we have a file for (or null). */
export function resolveBundledFamily(family: string): string | null {
  // font-family can be a list ("'Foo', sans-serif") or quoted — take the first token.
  const first = (family || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  if (FONT_FILES[first]) return first;
  const fallback = SYSTEM_FALLBACK[first.toLowerCase()];
  return fallback && FONT_FILES[fallback] ? fallback : null;
}

const fontCache = new Map<string, Promise<opentype.Font>>();

/** Load (and cache) the opentype.js Font for a family, resolving system fonts to a bundled equivalent. */
export function loadOpentypeFont(family: string): Promise<opentype.Font> | null {
  const resolved = resolveBundledFamily(family);
  if (!resolved) return null;
  const url = FONT_FILES[resolved];
  let p = fontCache.get(url);
  if (!p) {
    p = fetch(url).then(r => r.arrayBuffer()).then(buf => opentype.parse(buf));
    fontCache.set(url, p);
  }
  return p;
}

/**
 * Outline a single line of text to SVG path data, with the baseline at (x, y).
 * Built glyph-by-glyph via charToGlyph so we bypass opentype.js's GSUB/Bidi engine,
 * which throws on layout features (ccmp) present in several of these fonts. Honors
 * text-anchor. Returns null if the family isn't bundled (can't be outlined).
 */
export async function outlineString(
  family: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  anchor: 'start' | 'middle' | 'end' = 'start',
): Promise<string | null> {
  const fontP = loadOpentypeFont(family);
  if (!fontP) return null;
  const font = await fontP;
  const scale = fontSize / font.unitsPerEm;

  const glyphs = Array.from(text).map(ch => font.charToGlyph(ch));
  const advance = glyphs.reduce((w, g) => w + (g.advanceWidth || 0) * scale, 0);

  let penX = x - (anchor === 'middle' ? advance / 2 : anchor === 'end' ? advance : 0);
  const path = new opentype.Path();
  for (const g of glyphs) {
    path.extend(g.getPath(penX, y, fontSize));
    penX += (g.advanceWidth || 0) * scale;
  }
  return path.toPathData(3);
}

const dataUrlCache = new Map<string, Promise<string>>();

/** Fetch a bundled family's WOFF as a base64 data: URL (for @font-face embedding). Null if not bundled. */
export function loadFontDataUrl(family: string): Promise<string> | null {
  const resolved = resolveBundledFamily(family);
  if (!resolved) return null;
  const url = FONT_FILES[resolved];
  let p = dataUrlCache.get(url);
  if (!p) {
    p = fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => {
        let binary = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return `data:font/woff;base64,${btoa(binary)}`;
      });
    dataUrlCache.set(url, p);
  }
  return p;
}
