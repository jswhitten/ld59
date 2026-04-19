// MenuScene
// Scanner-style title reveal. The title starts invisible; each time the pulse
// ring sweeps over it, it flashes to full brightness and then decays back toward
// zero before the next pass.

export class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create() {
        const W = this.scale.width;
        const H = this.scale.height;

        this.createStarField(W, H);

        this.pulseOrigin = { x: W / 2, y: H + 120 };
        this.pulseRadius = 0;
        this.prevPulseRadius = 0;
        this.pulseSpeed = 620;
        this.pulseMax = Math.hypot(W / 2, H + 120) + 180;

        // Decay rate chosen so title fades to ~8% brightness by the next pulse hit.
        this.titleCycleTime = this.pulseMax / this.pulseSpeed;
        this.titleDecayRate = -Math.log(0.08) / this.titleCycleTime;

        this.titleHitElapsed = null;
        this.firstRevealDone = false;

        this.pulseGfx = this.add.graphics().setDepth(2);

        this.title = this.add.text(W / 2, H * 0.39, 'PULSE', {
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '72px',
            fontStyle: '700',
            color: '#7fffdf'
        }).setOrigin(0.5).setAlpha(0).setDepth(3);

        // Distance from pulse origin to title center (x is the same, so just y delta)
        this.titleDist = Math.abs(this.pulseOrigin.y - this.title.y);

        this.prompt = this.add.text(W / 2, H * 0.68, 'ENTER / SPACE TO START', {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '15px',
            color: '#ffddaa'
        }).setOrigin(0.5).setAlpha(0).setDepth(3);

        this.controls = this.add.text(W / 2, H * 0.68 + 28,
            'WASD/ARROWS MOVE   SHIFT FIRE   HOLD SPACE SCAN', {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '12px',
            color: '#76b8aa'
        }).setOrigin(0.5).setAlpha(0).setDepth(3);

        this.input.keyboard.once('keydown-ENTER', () => this.startGame());
        this.input.keyboard.once('keydown-SPACE', () => this.startGame());
        this.input.once('pointerdown', () => this.startGame());
    }

    update(time, delta) {
        const dt = delta / 1000;

        // Advance pulse; reset cleanly to avoid spurious crossing detection on wrap
        this.prevPulseRadius = this.pulseRadius;
        this.pulseRadius += this.pulseSpeed * dt;
        if (this.pulseRadius > this.pulseMax) {
            this.pulseRadius = 0;
            this.prevPulseRadius = 0;
        }

        this.updateTitle(dt, time);
        this.drawPulse();
    }

    updateTitle(dt, time) {
        // Detect pulse ring crossing the title center this frame
        if (this.prevPulseRadius < this.titleDist && this.pulseRadius >= this.titleDist) {
            this.titleHitElapsed = 0;
            if (!this.firstRevealDone) {
                this.firstRevealDone = true;
                this.controls.setAlpha(0.68);
            }
        }

        if (this.titleHitElapsed === null) {
            this.title.setAlpha(0);
        } else {
            const alpha = Math.exp(-this.titleDecayRate * this.titleHitElapsed);
            this.title.setAlpha(alpha < 0.01 ? 0 : alpha);
            this.titleHitElapsed += dt;
        }

        // Prompt breathes once revealed
        if (this.firstRevealDone) {
            this.prompt.setAlpha(0.52 + 0.28 * Math.sin(time * 0.004));
        }
    }

    drawPulse() {
        const g = this.pulseGfx;
        g.clear();

        const travel = Math.max(0, Math.min(1, this.pulseRadius / this.pulseMax));
        const baseAlpha = 0.82 * Math.pow(1 - travel, 0.55);
        if (baseAlpha <= 0) return;

        const bandWidth = 96;
        const layers = 10;
        const layerWidth = (bandWidth / layers) * 1.8;

        for (let i = 0; i < layers; i++) {
            const u = layers === 1 ? 0.5 : i / (layers - 1);
            const offset = (u - 0.5) * bandWidth;
            const radius = this.pulseRadius + offset;
            if (radius <= 0) continue;

            const centerFalloff = Math.exp(-Math.pow((u - 0.5) * 4.2, 2));
            const alpha = baseAlpha * centerFalloff * 0.42;
            g.lineStyle(layerWidth, 0x7fffdf, alpha);
            g.strokeCircle(this.pulseOrigin.x, this.pulseOrigin.y, radius);
        }
    }

    startGame() {
        this.scene.start('GameScene');
    }

    createStarField(W, H) {
        const g = this.add.graphics().setDepth(0);
        g.fillStyle(0x020610, 1);
        g.fillRect(0, 0, W, H);

        for (let i = 0; i < 160; i++) {
            const near = Math.random() > 0.82;
            const alpha = near ? Phaser.Math.FloatBetween(0.35, 0.72) : Phaser.Math.FloatBetween(0.12, 0.35);
            const radius = near ? Phaser.Math.FloatBetween(0.8, 1.6) : Phaser.Math.FloatBetween(0.35, 0.9);
            g.fillStyle(near ? 0x8fa8c0 : 0x4a5a72, alpha);
            g.fillCircle(Phaser.Math.Between(0, W), Phaser.Math.Between(0, H), radius);
        }
    }
}
