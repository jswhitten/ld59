// Projectile — player shot
// Travels in a straight line in the ship's facing direction.
// Acts as a mobile mini-pulse: reveals enemies within a small halo radius
// as it passes. Missed shots still give information about where enemies aren't.

import { wrappedDist } from '../utils/mathUtils.js';

export class Projectile extends Phaser.GameObjects.Container {
    constructor(scene, x, y, angle) {
        super(scene, x, y);
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.speed = 510;
        this.revealRadius = 44;
        this.lifetime = 2.5;    // seconds before auto-expire
        this.age = 0;
        this.isDead = false;
        this.pingedEnemies = new Set();

        const r = 3;
        this.body.setCircle(r, -r, -r);
        this.body.setVelocity(Math.cos(angle) * this.speed, Math.sin(angle) * this.speed);

        this.setDepth(3);
        this.createVisual();
    }

    createVisual() {
        const g = this.scene.add.graphics();

        // Projectile core — blue-white to distinguish player fire from hostile red shots.
        g.fillStyle(0x88d8ff, 0.95);
        g.fillCircle(0, 0, 2.8);
        g.fillStyle(0xffffff, 0.9);
        g.fillCircle(0, 0, 1.2);

        this.add(g);
        this.postFX.addBloom(0x9fe8ff, 1, 1, 1.8, 3.4, 4);
    }

    update(delta, enemies) {
        if (this.isDead) return;
        this.age += delta / 1000;

        if (this.age >= this.lifetime) {
            this.die();
            return;
        }

        // Reveal enemies inside the halo — the projectile as a traveling pulse
        const worldSize = this.scene.worldSize;
        for (const enemy of enemies) {
            if (enemy.isDead) continue;
            const d = wrappedDist(this.x, this.y, enemy.x, enemy.y, worldSize);
            if (d <= this.revealRadius) {
                enemy.reveal();
                if (!this.pingedEnemies.has(enemy)) {
                    this.pingedEnemies.add(enemy);
                    this.scene.addSignalBlip(enemy.x, enemy.y, 'ship', 0.78, enemy.radius, enemy);
                }
            }
        }

    }

    hitEnemy(enemy) {
        const killed = enemy.takeDamage();
        this.die();
        return killed;
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;
        this.destroy();
    }
}
