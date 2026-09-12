// Il modulo virtuale delle texture del tema, letto da card.css (vite-theme.ts).
declare module "virtual:theme-t49" {
  interface Cracks {
    /** I nuclei delle crepe: SVG in linea (data URI), 520×330 stirato. */
    cores: string;
    /** Il bagliore delle crepe: PNG già sfocato (data URI), 1040×660. */
    glow: string;
  }
  const theme: {
    stoneTex: string;
    groundTex: string;
    cracks: { destructive: Cracks; dynamic: Cracks; dimensional: Cracks };
  };
  export default theme;
}
