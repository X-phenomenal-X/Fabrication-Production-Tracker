/* Exact three-shape BV mark shared by the screen and paper lockups.

   Keep this markup in one module. The old print header redrew the logo as one
   clipped gradient wedge, which changed both the geometry and colour breaks
   on paper even though the on-screen header was correct. */

export const BRAND_MARK_SVG = `
<svg viewBox="0 0 32 32" role="img" aria-label="BV Glazing Systems" focusable="false">
  <rect x="0" y="0"  width="18" height="15" fill="var(--mark-a)"/>
  <rect x="0" y="17" width="18" height="15" fill="var(--mark-b)"/>
  <path d="M19 0 H31.5 L25.2 15 H19 Z" fill="var(--mark-c)"/>
  <path d="M19 17 H24.4 L19 30 Z" fill="var(--mark-c)"/>
</svg>`;
