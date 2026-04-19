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
        this.done = false;

        this.gfx = scene.add.graphics().setDepth(4);
    }

    update(delta) {
        this.currentRadius += this.speed * delta / 1000;

        const t = this.currentRadius / this.maxRadius;
        if (t >= 1) {
            this.done = true;
            if (this.gfx.active) this.gfx.destroy();
            return;
        }

        const alpha = Math.pow(1 - t, 1.2) * 0.5 * this.strength;
        this.gfx.clear();
        if (alpha < 0.01) return;

        this.gfx.lineStyle((10 + 24 * this.strength) * 1.8, 0xffbb44, alpha * 0.62);
        this.gfx.strokeCircle(this.x, this.y, this.currentRadius);
    }

    destroy() {
        if (this.gfx && this.gfx.active) this.gfx.destroy();
        this.done = true;
    }
}
