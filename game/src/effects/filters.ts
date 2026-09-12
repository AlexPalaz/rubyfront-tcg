// I filtri degli effetti (animazioni, 2026-09-12). Due fatti qui in GLSL —
// il riflesso «foil» delle Uniche (un'iride che scorre in diagonale e un
// guizzo di luce, spostati dall'inclinazione della carta) e la bruciatura
// di chi muore (la carta si consuma su un rumore, col bordo incandescente) —
// e quelli di pixi-filters, già pronti: onda d'urto, bagliore, bloom, zoom.

import { Filter, GlProgram, UniformGroup } from "pixi.js";
import { AdvancedBloomFilter, GlowFilter, ShockwaveFilter, ZoomBlurFilter } from "pixi-filters";

/** Il vertice standard dei filtri di Pixi v8 (defaultFilter.vert). */
const VERTEX_SHADER = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

const FOIL_SHADER = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// In alta precisione come nel vertice, o il programma non si collega.
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform float uTime;
uniform float uStrength;
uniform vec2 uLight;

vec3 iridescence(float h)
{
    return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    if (c.a <= 0.0) { finalColor = c; return; }
    // Le coordinate 0..1 sulla carta, non sulla texture del filtro.
    vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
    float d = uv.x * 0.75 + uv.y * 0.55 + uLight.x * 0.45 + uLight.y * 0.25;
    float band = sin((d - uTime * 0.22) * 11.0) * 0.5 + 0.5;
    vec3 color = iridescence(fract(d * 1.4 + uTime * 0.08));
    float flicker = pow(max(0.0, 1.0 - abs(fract(d * 0.8 - uTime * 0.3) - 0.5) * 7.0), 3.0);
    vec3 rgb = c.rgb + (color * 0.2 * band + vec3(flicker) * 0.4) * uStrength * c.a;
    finalColor = vec4(rgb, c.a);
}
`;

const BURN_SHADER = `in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
// In alta precisione come nel vertice, o il programma non si collega.
uniform highp vec4 uInputSize;
uniform highp vec4 uOutputFrame;
uniform float uThreshold;
uniform vec3 uEdgeColor;

float random(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p)
{
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(random(i), random(i + vec2(1.0, 0.0)), u.x), mix(random(i + vec2(0.0, 1.0)), random(i + vec2(1.0, 1.0)), u.x), u.y);
}
float layers(vec2 p)
{
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
}

void main(void)
{
    vec4 c = texture(uTexture, vTextureCoord);
    vec2 uv = vTextureCoord * uInputSize.xy / uOutputFrame.zw;
    // La carta brucia dal basso verso l'alto, frastagliata dal rumore.
    float n = layers(uv * 5.0) * 0.7 + (1.0 - uv.y) * 0.3;
    float e = n - uThreshold;
    if (e < 0.0) { finalColor = vec4(0.0); return; }
    float edge = smoothstep(0.09, 0.0, e);
    float ember = smoothstep(0.2, 0.0, e);
    vec3 rgb = mix(c.rgb, c.rgb * vec3(0.35, 0.2, 0.15), ember) + uEdgeColor * edge * 1.4 * c.a;
    finalColor = vec4(rgb, c.a);
}
`;

/** Il riflesso delle Uniche: `tempo` scorre, `luce` segue l'inclinazione della carta (−1..1). */
export class FoilFilter extends Filter {
  constructor(strength = 1) {
    super({
      glProgram: GlProgram.from({ vertex: VERTEX_SHADER, fragment: FOIL_SHADER, name: "rubyfront-foil" }),
      resources: {
        foil: new UniformGroup({
          uTime: { value: 0, type: "f32" },
          uStrength: { value: strength, type: "f32" },
          uLight: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
        }),
      },
    });
  }

  set time(value: number) {
    this.resources.foil.uniforms.uTime = value;
  }

  set strength(value: number) {
    this.resources.foil.uniforms.uStrength = value;
  }

  light(x: number, y: number): void {
    const light = this.resources.foil.uniforms.uLight as Float32Array;
    light[0] = x;
    light[1] = y;
  }
}

/** La bruciatura: `soglia` da 0 (intera) a 1 (sparita), col bordo del colore dato. */
export class BurnFilter extends Filter {
  constructor(edge: [number, number, number] = [1, 0.45, 0.15]) {
    super({
      glProgram: GlProgram.from({ vertex: VERTEX_SHADER, fragment: BURN_SHADER, name: "rubyfront-burn" }),
      resources: {
        burn: new UniformGroup({
          uThreshold: { value: 0, type: "f32" },
          uEdgeColor: { value: new Float32Array(edge), type: "vec3<f32>" },
        }),
      },
    });
  }

  set threshold(value: number) {
    this.resources.burn.uniforms.uThreshold = value;
  }
}

/** L'onda d'urto, centrata in coordinate dello schermo; `time` la fa correre. */
export function shockwave(x: number, y: number, amplitude = 26): ShockwaveFilter {
  return new ShockwaveFilter({ center: { x, y }, amplitude: amplitude, wavelength: 150, speed: 1100, brightness: 1.12, radius: -1, time: 0 });
}

/** Il bagliore attorno a una sagoma. */
export function glowFilter(color: number, strength = 3): GlowFilter {
  return new GlowFilter({ distance: 18, outerStrength: strength, innerStrength: 0, color: color, quality: 0.25 });
}

/** Il bloom dei momenti forti: le luci del tavolo che sbordano. */
export function bloom(): AdvancedBloomFilter {
  return new AdvancedBloomFilter({ threshold: 0.55, bloomScale: 1.1, brightness: 1, blur: 6, quality: 4 });
}

/** Lo zoom di un colpo, verso il punto dato (coordinate dello schermo). */
export function hitZoom(x: number, y: number): ZoomBlurFilter {
  return new ZoomBlurFilter({ strength: 0.12, center: { x, y }, innerRadius: 60, radius: -1 });
}
