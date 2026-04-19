// EnemyProjectile - hostile shot.
// Visually and mechanically distinct from the player's scanner-revealing projectile.

export class EnemyProjectile extends Phaser.GameObjects.Container {
    constructor(scene, x, y, angle, speed = 280) {
        super(scene, x, y);
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.radius = 4.5;
        this.speed = speed;
        this.lifetime = 3.0;
        this.age = 0;
        this.isDead = false;

        this.body.setCircle(this.radius, -this.radius, -this.radius);
        this.body.setVelocity(Math.cos(angle) * this.speed, Math.sin(angle) * this.speed);

        this.rotation = angle;
        this.setDepth(3);
        this.createVisual();
    }

    createVisual() {
        const g = this.scene.add.graphics();

        g.lineStyle(1.2, 0xff6655, 0.78);
        g.lineBetween(-7, 0, 7, 0);
        g.fillStyle(0xff6655, 0.84);
        g.fillCircle(0, 0, 3.2);
        g.fillStyle(0xffcc88, 0.56);
        g.fillCircle(0, 0, 1.4);

        this.add(g);
        this.postFX.addBloom(0xff6655, 1, 1, 1.8, 3.4, 4);
    }

    update(delta) {
        if (this.isDead) return;

        this.age += delta / 1000;
        if (this.age >= this.lifetime) this.die();
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;
        this.destroy();
    }
}
