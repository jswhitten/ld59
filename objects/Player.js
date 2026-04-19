// Player
// The player craft: a small ship rendered as simple geometry with a faint warm glow.
// Asteroids-style controls: rotate with A/D or Left/Right, thrust with W/Up, reverse with S/Down.
// The ship fires in the direction it's facing. No mouse involvement.

export class Player extends Phaser.GameObjects.Container {
    constructor(scene, x, y) {
        super(scene, x, y);
        scene.add.existing(this);
        scene.physics.add.existing(this);

        // Tuning
        this.rotationSpeed = 3;       // radians/sec - full turn in ~2s
        this.thrustAccel = 520;       // forward thrust strength
        this.reverseAccel = 320;      // reverse thrust strength (weaker)
        this.maxSpeed = 280;
        this.drag = 0.5;              // low drag - space-ish, but not uncontrollable

        // Hitbox - circular, centered
        this.body.setCircle(12, -12, -12);
        // No world-bounds collision - GameScene wraps the player via physics.world.wrap().
        this.body.setDamping(true);
        this.body.setDrag(this.drag, this.drag);
        this.body.setMaxVelocity(this.maxSpeed);

        // Facing angle in radians. 0 = right (Phaser convention).
        // The ship visual is drawn pointing right at rotation 0, so rotation directly equals facing.
        this.facing = -Math.PI / 2; // start pointing "up" visually
        this.thrustInput = 0;

        this.setDepth(10);
        this.createVisual();
    }

    createVisual() {
        const g = this.scene.add.graphics();

        // Engine glow
        g.fillStyle(0xff3300, 0.9);
        g.fillCircle(-8, 0, 1.5);

        // Ship body - triangle with a rear notch
        g.lineStyle(1.5, 0xffaa99);
        g.beginPath();
        g.moveTo(9, 0);
        g.lineTo(-9, 7);
        g.lineTo(-6, 0);
        g.lineTo(-9, -7);
        g.closePath();
        g.strokePath();

        // Front window
        g.fillStyle(0x3366ff, 0.9);
        g.fillCircle(2, 0, 1.5);

        this.visual = g;
        this.thrustFlare = null;

        this.add(g);
        this.postFX.addBloom(0xffddaa, 1, 1, 1.45, 2.55, 4);
    }

    update(cursors, wasd, delta) {
        const dt = delta / 1000;

        // --- Rotation ---
        let turn = 0;
        if (cursors.left.isDown || wasd.left.isDown) turn -= 1;
        if (cursors.right.isDown || wasd.right.isDown) turn += 1;
        this.facing += turn * this.rotationSpeed * dt;
        this.rotation = this.facing;

        // --- Thrust ---
        let thrustInput = 0;
        if (cursors.up.isDown || wasd.up.isDown) thrustInput += 1;
        if (cursors.down.isDown || wasd.down.isDown) thrustInput -= 1;
        this.thrustInput = thrustInput;

        if (thrustInput !== 0) {
            const accel = thrustInput > 0 ? this.thrustAccel : this.reverseAccel;
            const ax = Math.cos(this.facing) * thrustInput * accel;
            const ay = Math.sin(this.facing) * thrustInput * accel;
            this.body.setAcceleration(ax, ay);
        } else {
            this.body.setAcceleration(0, 0);
        }

        // --- Thrust flare visual ---
        this.updateThrustFlare(thrustInput > 0);
    }

    updateThrustFlare(on) {
        // Small flare graphic behind the ship when thrusting forward.
        if (!this.thrustFlare) {
            const f = this.scene.add.graphics();
            f.fillStyle(0xffaa55, 0.85);
            f.fillTriangle(-9, 0, -16, 4, -16, -4);
            f.fillStyle(0xffeecc, 0.6);
            f.fillTriangle(-9, 0, -13, 2, -13, -2);
            f.postFX.addBloom(0xffaa55, 1, 1, 1.8, 3.4, 4);
            this.thrustFlare = f;
            this.addAt(f, 0); // behind the ship visual
        }

        if (on) {
            // Flicker the flare so it feels alive.
            const flicker = 0.75 + Math.random() * 0.25;
            this.thrustFlare.setVisible(true);
            this.thrustFlare.setAlpha(flicker);
            this.thrustFlare.setScale(0.85 + Math.random() * 0.3, 1);
        } else {
            this.thrustFlare.setVisible(false);
        }
    }
}
