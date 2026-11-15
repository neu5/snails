/** Grave markers left where a snail dies; each team picks one (GameConfig.graves). */
export const GRAVES = ['Shell', 'Stone', 'Cross', 'Daisy', 'Toadstool', 'Urn'] as const;

/**
 * Draws grave `style` standing on the ground at (x, y), about 18 px tall at scale 1.
 * Unknown styles fall back to the shell.
 */
export function drawGrave(ctx: CanvasRenderingContext2D, style: number, x: number, y: number, scale = 1): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  switch (style) {
    case 1: {
      // Headstone with a rounded top and a carved cross.
      ctx.fillStyle = '#9ea4ad';
      ctx.strokeStyle = '#5c626b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(-6, -11);
      ctx.arc(0, -11, 6, Math.PI, 0);
      ctx.lineTo(6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#6b717a';
      ctx.beginPath();
      ctx.moveTo(0, -14);
      ctx.lineTo(0, -6);
      ctx.moveTo(-2.5, -11);
      ctx.lineTo(2.5, -11);
      ctx.stroke();
      break;
    }
    case 2: {
      // Wooden cross.
      ctx.fillStyle = '#8a5a32';
      ctx.strokeStyle = '#4e3018';
      ctx.lineWidth = 1;
      ctx.fillRect(-1.5, -18, 3, 18);
      ctx.strokeRect(-1.5, -18, 3, 18);
      ctx.fillRect(-6, -14, 12, 3);
      ctx.strokeRect(-6, -14, 12, 3);
      break;
    }
    case 3: {
      // A daisy on a little mound.
      ctx.fillStyle = '#5b3d24';
      ctx.beginPath();
      ctx.ellipse(0, 0, 7, 3, 0, Math.PI, 0);
      ctx.fill();
      ctx.strokeStyle = '#4d9a3c';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.quadraticCurveTo(2, -8, 0, -13);
      ctx.moveTo(1, -6);
      ctx.quadraticCurveTo(4, -8, 5, -6);
      ctx.stroke();
      ctx.fillStyle = '#f4f4f0';
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * 3, -14 + Math.sin(a) * 3, 2.2, 1.4, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(0, -14, 1.8, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 4: {
      // Toadstool: red spotted cap on a pale stalk.
      ctx.fillStyle = '#efe6d2';
      ctx.fillRect(-2.5, -9, 5, 9);
      ctx.fillStyle = '#c62f2f';
      ctx.beginPath();
      ctx.moveTo(-8, -8);
      ctx.quadraticCurveTo(0, -22, 8, -8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      for (const [dx, dy, r] of [
        [-3.5, -11, 1.4],
        [2, -14, 1.6],
        [4.5, -10, 1.1],
      ]) {
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 5: {
      // Bronze urn with a lid.
      ctx.fillStyle = '#b07a3a';
      ctx.strokeStyle = '#6e4a1f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      ctx.lineTo(4, 0);
      ctx.quadraticCurveTo(8, -7, 4, -13);
      ctx.lineTo(-4, -13);
      ctx.quadraticCurveTo(-8, -7, -4, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d29a52';
      ctx.fillRect(-5, -15, 10, 2.5);
      ctx.beginPath();
      ctx.arc(0, -16, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#e8b878';
      ctx.beginPath();
      ctx.moveTo(-3, -6);
      ctx.lineTo(3, -6);
      ctx.stroke();
      break;
    }
    default: {
      // Empty shell.
      ctx.fillStyle = '#8a8a8a';
      ctx.beginPath();
      ctx.arc(0, -6, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, -6, 3, 0, Math.PI * 1.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}
