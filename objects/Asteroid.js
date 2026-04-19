// Asteroid
// Moving scanner clutter: always faintly visible, brighter when close or pinged.
// Asteroids drift, rotate, bounce off each other, and larger ones can split.

export class Asteroid extends Phaser.GameObjects.Container {
    constructor(scene, x, y, radius) {
        super(scene, x, y);
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.radius = radius;
        this.isMeteoroid = radius <= 8;
        this.revealDuration = 0.18;
        this.revealTimer = 0;
        this.revealBrightness = 0.85;
        this.baseAlpha = this.isMeteoroid ? 0.34 : 0.24;
        this.localVisibility = 0;
        this.rotationRate = Phaser.Math.FloatBetween(-0.85, 0.85) * (42 / Math.max(12, radius));
        this.mass = radius * radius;
        this.collisionCooldown = 0;
        this.isDead = false;

        this.body.setCircle(radius, -radius, -radius);
        this.body.setBounce(1, 1);

        const angle = Math.random() * Math.PI * 2;
        const speed = this.isMeteoroid
            ? Phaser.Math.FloatBetween(38, 92)
            : Phaser.Math.FloatBetween(14, 44) * (56 / Math.max(24, radius));
        this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

        this.setDepth(1);
        this.createVisual();
        this.setAlpha(this.baseAlpha);
    }

    get isRevealed() { return this.revealTimer > 0; }
    get radarAlpha() { return Math.max(this.baseAlpha, this.localVisibility, this.revealTimer > 0 ? 0.75 : 0); }

    reveal(brightness = 0.85, duration = this.revealDuration) {
        this.revealTimer = duration;
        this.revealBrightness = brightness;
    }

    setLocalVisibility(alpha) {
        this.localVisibility = Math.max(0, Math.min(1, alpha));
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;
        this.destroy();
    }

    createVisual() {
        const g = this.scene.add.graphics();
        const points = [];
        const verts = this.isMeteoroid ? Phaser.Math.Between(5, 7) : Phaser.Math.Between(9, 14);

        for (let i = 0; i < verts; i++) {
            const a = (i / verts) * Math.PI * 2;
            const r = this.radius * Phaser.Math.FloatBetween(0.68, 1.08);
            points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
        }

        g.fillStyle(this.isMeteoroid ? 0x30343a : 0x24282d, this.isMeteoroid ? 0.88 : 0.96);
        g.beginPath();
        g.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            g.lineTo(points[i].x, points[i].y);
        }
        g.closePath();
        g.fillPath();

        g.lineStyle(this.isMeteoroid ? 1 : 1.2, 0x9aa3aa, this.isMeteoroid ? 0.72 : 0.88);
        g.beginPath();
        g.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
            g.lineTo(points[i].x, points[i].y);
        }
        g.closePath();
        g.strokePath();

        if (this.isMeteoroid) {
            g.fillStyle(0x9aa3aa, 0.34);
            g.fillCircle(0, 0, Math.max(1.5, this.radius * 0.32));
        } else {
            g.lineStyle(1, 0xb7bdc3, 0.22);
            for (let i = 0; i < points.length; i += 3) {
                const p = points[i];
                g.lineBetween(p.x * 0.35, p.y * 0.35, p.x * 0.86, p.y * 0.86);
            }
        }

        this.add(g);
    }

    update(delta) {
        const dt = delta / 1000;
        this.rotation += this.rotationRate * dt;
        this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);

        let revealAlpha = 0;
        if (this.revealTimer > 0) {
            this.revealTimer -= dt;
            const fade = Math.min(1, this.revealTimer / this.revealDuration);
            revealAlpha = Math.max(0, fade) * this.revealBrightness;
        }

        this.setAlpha(Math.max(this.baseAlpha, this.localVisibility, revealAlpha));
    }
}
