// EchoRing — visible return echo from a contact hit by a pulse.
// Spawns at the contact position and expands outward in warm amber,
// distinguishing it from the outgoing cyan pulse ring.
// strength (0-1) scales both brightness and max radius.

export class EchoRing {
    constructor(scene, x, y, strength = 1) {
        this.scene    = scene;
        this.x        = x;
        this.y        = y;
        this.strength = strength;
        this.maxRadius   = 120 + 280 * strength;   // 120–400 px — noticeably smaller than pulse (260–2160)
        this.speed       = 420;                    // px/s — slow enough to watch arrive and fade
        this.currentRadius = 4;
        this.prevRadius    = 0;
        this.done = false;

        this.gfx = scene.add.graphics();
        this.gfx.setDepth(4);
    }

    update(delta) {
        const dt = delta / 1000;
        this.prevRadius    = this.currentRadius;
        this.currentRadius += this.speed * dt;

        const t = this.currentRadius / this.maxRadius;
        if (t >= 1) {
            this.done = true;
            if (this.gfx.active) this.gfx.destroy();
            return;
        }

        const alpha = Math.pow(1 - t, 1.2) * 0.78 * this.strength;
        this.gfx.clear();
        if (alpha < 0.01) return;

        const ringWidth = 40 + 24 * this.strength;
        const numLayers = 7;
        const strokeW   = (ringWidth / numLayers) * 1.8;

        for (let i = 0; i < numLayers; i++) {
            const u      = i / (numLayers - 1);
            const offset = (u - 0.5) * ringWidth;
            const r      = this.currentRadius + offset;
            if (r < 0) continue;

            const gauss      = Math.exp(-Math.pow((u - 0.5) * 3.8, 2));
            const layerAlpha = alpha * gauss * 0.62;

            this.gfx.lineStyle(strokeW, 0xffbb44, layerAlpha);
            this.gfx.strokeCircle(this.x, this.y, r);
        }
    }

    destroy() {
        if (this.gfx && this.gfx.active) this.gfx.destroy();
        this.done = true;
    }
}
