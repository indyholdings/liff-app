/* Which brand this copy of the staff UI wears. Loaded before ui/app.js on every page, and before
 * content.js on chat.line.biz. This default is the neutral one; `node scripts/build-brand.mjs <brand>`
 * writes a branded copy of the extension with its own brand.js, logos and fonts.
 * Asset paths (logo_mark, logo_landscape, fonts_css …) are relative to the extension root.
 */
window.SIDECAR_BRAND = { id: 'sidecar', name: 'Sidecar', theme: 'default' };
