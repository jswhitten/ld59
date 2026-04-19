// Drifter — slow, steady ranged attacker.
// Passive: drifts at constant velocity in a random direction.
// Alert: approaches, fires, then veers off instead of deliberately colliding.

import { Enemy } from './Enemy.js';

export class Drifter extends Enemy {
    static type = 'drifter';
    constructor(scene, x, y) {
        super(scene, x, y);

        const speed = Phaser.Math.FloatBetween(38, 72);
        const angle = Math.random() * Math.PI * 2;
        this.driftVX = Math.cos(angle) * speed;
        this.driftVY = Math.sin(angle) * speed;
        this.body.setVelocity(this.driftVX, this.driftVY);

        this.rotationRate = Phaser.Math.FloatBetween(-0.25, 0.25);
        this.attackRange = 460;
        this.fireCooldown = 1.7;
        this.shotSpeed = 250;
        this.aimError = 0.13;
        this.alertSpeed = 130;
        this.veerSpeed = 170;
        this.veerRadius = 150;
        this.attackRunTime = 0.34;
        this.attackWindow = 2.7;
        this.veerTime = 0.82;
        this.recoverTime = 0.58;
        this.maxSpeed = 190;
        this.scoreValue = 10;
        this.collisionDamage = 82;
        this.explosionScale = 1;
    }

    createVisual() {
        const g = this.scene.add.graphics();

        // Compact hexagonal drifting craft: smaller and less aggressive than Seekers.
        g.lineStyle(1.5, 0x4dff88, 0.92);
        g.beginPath();
        g.moveTo(0, -10);
        g.lineTo(9, -5);
        g.lineTo(9, 5);
        g.lineTo(0, 10);
        g.lineTo(-9, 5);
        g.lineTo(-9, -5);
        g.closePath();
        g.strokePath();

        // Simple inner frame
        g.lineStyle(0.5, 0x4dff88, 0.42);
        g.lineBetween(-6, 0, 6, 0);
        g.lineBetween(-4, -5, 4, 5);
        g.lineBetween(4, -5, -4, 5);

        this.add(g);
    }

    updateMovement(delta) {
        const dt = delta / 1000;
        this.rotation += this.rotationRate * dt;

        if (!this.isAlert || !this.lastKnownPos) {
            this.combatState = 'patrol';
            this.blendVelocity(this.driftVX, this.driftVY, 1.8, dt);
            this.applyLocalAvoidance(dt, { rockForce: 260, shipForce: 180 });
            return;
        }

        const player = this.scene.player;
        const playerVector = this.wrappedVectorTo(player.x, player.y);
        const playerDistance = Math.sqrt(playerVector.x * playerVector.x + playerVector.y * playerVector.y);

        if (this.combatState === 'patrol') {
            this.combatState = 'approach';
        }

        if ((this.combatState === 'approach' || this.combatState === 'attackRun') &&
            playerDistance < this.veerRadius) {
            this.combatState = 'veerOff';
            this.combatTimer = this.veerTime;
        }

        if (this.combatState === 'attackRun' && this.combatTimer <= 0) {
            this.combatState = 'veerOff';
            this.combatTimer = this.veerTime;
        }

        if (this.combatState === 'veerOff') {
            this.steerAwayFromPoint(player.x, player.y, this.veerSpeed, 4.4, dt, this.flybySide * 0.28);
            if (this.combatTimer <= 0) {
                this.combatState = 'recover';
                this.combatTimer = this.recoverTime;
            }
        } else if (this.combatState === 'recover') {
            this.steerAwayFromPoint(player.x, player.y, this.alertSpeed * 0.82, 2.5, dt, this.flybySide * 0.18);
            if (this.combatTimer <= 0 || playerDistance > this.veerRadius * 1.55) {
                this.combatState = this.isAlert ? 'approach' : 'patrol';
                this.flybySide *= -1;
            }
        } else if (this.combatState === 'attackRun') {
            this.steerTowardPoint(this.lastKnownPos.x, this.lastKnownPos.y, this.alertSpeed, 1.5, dt, this.flybySide * 0.08);
        } else {
            const targetDistance = this.steerTowardPoint(
                this.lastKnownPos.x,
                this.lastKnownPos.y,
                this.alertSpeed,
                3.2,
                dt,
                this.flybySide * 0.12
            );
            if (targetDistance < 18) {
                this.alertTimer = 0;
                this.combatState = 'patrol';
            }
        }

        this.applyLocalAvoidance(dt, {
            avoidPlayer: this.combatState !== 'approach' || playerDistance < this.veerRadius * 1.25,
            playerRadius: this.veerRadius,
            rockForce: 330,
            shipForce: 240,
            playerForce: 430
        });
    }
}
