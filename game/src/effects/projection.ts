// La carta in prospettiva (animazioni, 2026-09-12): la texture di una carta
// su un PerspectiveMesh, girata attorno ai suoi assi con una camera a
// distanza — il tilt delle carte in mano che seguono il puntatore, il giro
// del flip al Nexus (a metà giro la faccia cambia), il volo con l'arco di
// una giocata. Il centro della carta è l'origine del contenitore.

import { Container, PerspectiveMesh, type Texture } from "pixi.js";

export class Card3D extends Container {
  readonly mesh: PerspectiveMesh;
  private rx = 0;
  private ry = 0;
  private rz = 0;
  private back: Texture | null = null;
  private frontFace: Texture;

  constructor(
    texture: Texture,
    readonly w: number,
    readonly h: number,
    /** La distanza della camera: più è corta, più la prospettiva è forte. */
    private readonly distance = 1600
  ) {
    super({ label: "card-3d" });
    this.frontFace = texture;
    this.mesh = new PerspectiveMesh({ texture, verticesX: 12, verticesY: 12 });
    this.mesh.eventMode = "none";
    this.addChild(this.mesh);
    this.update();
  }

  /** Cambia la faccia davanti (finito un flip, il Nexus resta davanti). */
  face(texture: Texture): void {
    this.frontFace = texture;
    this.back = null;
    this.update();
  }

  /** La faccia che si vede quando la carta ha fatto mezzo giro (il flip). */
  setBack(texture: Texture): void {
    this.back = texture;
  }

  /** Angoli in radianti: rx inclina avanti/indietro, ry gira di lato, rz ruota nel piano. */
  rotateTo(rx: number, ry: number, rz = 0): void {
    this.rx = rx;
    this.ry = ry;
    this.rz = rz;
    this.update();
  }

  private update(): void {
    // Oltre il quarto di giro si vede l'altra faccia, specchiata di nuovo dritta.
    const pastQuarter = Math.cos(this.ry) < 0;
    const texture = pastQuarter && this.back ? this.back : this.frontFace;
    if (this.mesh.texture !== texture) this.mesh.texture = texture;
    const mirror = pastQuarter ? -1 : 1;
    const points: [number, number][] = [
      [-this.w / 2, -this.h / 2],
      [this.w / 2, -this.h / 2],
      [this.w / 2, this.h / 2],
      [-this.w / 2, this.h / 2],
    ];
    const cx = Math.cos(this.rx);
    const sx = Math.sin(this.rx);
    const cy = Math.cos(this.ry);
    const sy = Math.sin(this.ry);
    const cz = Math.cos(this.rz);
    const sz = Math.sin(this.rz);
    const cornerPoints = points.map(([px0, py]) => {
      const px = px0 * mirror;
      // Giro nel piano, poi attorno a Y, poi attorno a X.
      const x1 = px * cz - py * sz;
      const y1 = px * sz + py * cz;
      const x2 = x1 * cy;
      const z2 = -x1 * sy;
      const y3 = y1 * cx - z2 * sx;
      const z3 = y1 * sx + z2 * cx;
      const s = this.distance / (this.distance + z3);
      return [x2 * s, y3 * s] as const;
    });
    const [a, b, c, d] = cornerPoints as unknown as [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]];
    this.mesh.setCorners(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
  }
}
