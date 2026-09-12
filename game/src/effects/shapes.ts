// Le forme delle particelle (animazioni, 2026-09-12): punti di luce,
// scintille allungate, fiocchi di cenere, lingue di fiamma, anelli. Si
// dipingono bianche una volta sola: il colore lo dà la tinta della particella.

import type { Texture } from "pixi.js";
import { paintPiece } from "../table/appearance";

export type Shape = "dot" | "spark" | "ash" | "flame" | "ring";

const cache = new Map<Shape, Texture>();

export function shape(name: Shape): Texture {
  let texture = cache.get(name);
  if (!texture) {
    texture = paint(name);
    cache.set(name, texture);
  }
  return texture;
}

function paint(name: Shape): Texture {
  switch (name) {
    case "dot":
      return paintPiece(32, 32, 2, ctx => {
        const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.35, "rgba(255,255,255,.55)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 32, 32);
      });
    case "spark":
      return paintPiece(48, 10, 2, ctx => {
        const g = ctx.createLinearGradient(0, 0, 48, 0);
        g.addColorStop(0, "rgba(255,255,255,0)");
        g.addColorStop(0.7, "rgba(255,255,255,1)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(24, 5, 24, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      });
    case "ash":
      return paintPiece(14, 14, 2, ctx => {
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(2, 5);
        ctx.lineTo(8, 1);
        ctx.lineTo(13, 6);
        ctx.lineTo(10, 13);
        ctx.lineTo(4, 12);
        ctx.closePath();
        ctx.fill();
      });
    case "flame":
      return paintPiece(32, 48, 2, ctx => {
        const g = ctx.createRadialGradient(16, 32, 0, 16, 30, 22);
        g.addColorStop(0, "rgba(255,255,255,1)");
        g.addColorStop(0.5, "rgba(255,255,255,.5)");
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(16, 2);
        ctx.quadraticCurveTo(30, 26, 26, 38);
        ctx.quadraticCurveTo(16, 50, 6, 38);
        ctx.quadraticCurveTo(2, 26, 16, 2);
        ctx.fill();
      });
    case "ring":
      return paintPiece(64, 64, 2, ctx => {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 4;
        ctx.shadowColor = "#ffffff";
        ctx.shadowBlur = 10 * 2;
        ctx.beginPath();
        ctx.arc(32, 32, 24, 0, Math.PI * 2);
        ctx.stroke();
      });
  }
}
