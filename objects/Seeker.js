// Seeker — faster ranged hunter that curves into attack runs, then breaks away.

import { Enemy } from './Enemy.js';

export class Seeker extends Enemy {
    static type = 'seeker';
    constructor(scene, x, y) {
        super(scene, x, y);

        this.radius = 13;
        this.body.setCircle(this.radius, -this.radius, -this.radius);

        const speed = Phaser.Math.FloatBetween(76, 104);
        const angle = Math.random() * Math.PI * 2;
        this.body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);

        this.driftSpeed = speed;
        this.alertSpeed = 220;
        this.steering = 6.0;
        this.rotationRate = Phaser.Math.FloatBetween(-0.7, 0.7);
        this.orbitBias = Phaser.Math.RND.pick([-1, 1]);
        this.alertDuration = 6.5;
        this.attackRange = 560;
        this.fireCooldown = 1.2;
        this.shotSpeed = 310;
        this.aimError = 0.075;
        this.veerSpeed = 230;
        this.veerRadius = 170;
        this.attackRunTime = 0.42;
        this.attackWindow = 2.75;
        this.veerTime = 0.72;
        this.recoverTime = 0.48;
        this.maxSpeed = 255;
        this.scoreValue = 25;
        this.collisionDamage = 105;
        this.explosionScale = 1.22;
    }

    createVisual() {
        const g = this.scene.add.graphics();

        // Narrow diamond profile, distinct from the rounded Drifter silhouette.
        g.lineStyle(1.5, 0x7dffad, 0.95);
        g.beginPath();
        g.moveTo(0, -15);
        g.lineTo(12, 0);
        g.lineTo(0, 15);
        g.lineTo(-12, 0);
        g.closePath();
        g.strokePath();

        g.lineStyle(1, 0x7dffad, 0.45);
        g.lineBetween(0, -10, 0, 10);
        g.lineBetween(-7, 0, 7, 0);
        g.strokeCircle(0, 0, 4);

        this.add(g);
    }

    updateMovement(delta) {
        const dt = delta / 1000;
        this.rotation += this.rotationRate * dt;

        if (!this.isAlert || !this.lastKnownPos) {
            this.combatState = 'patrol';
            this.clampSpeed(this.driftSpeed);
            this.applyLocalAvoidance(dt, { rockForce: 280, shipForce: 200 });
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
            this.steerAwayFromPoint(player.x, player.y, this.veerSpeed, 6.4, dt, this.orbitBias * 0.36);
            if (this.combatTimer <= 0) {
                this.combatState = 'recover';
                this.combatTimer = this.recoverTime;
            }
        } else if (this.combatState === 'recover') {
            this.steerAwayFromPoint(player.x, player.y, this.alertSpeed * 0.92, 3.8, dt, this.orbitBias * 0.24);
            if (this.combatTimer <= 0 || playerDistance > this.veerRadius * 1.45) {
                this.combatState = this.isAlert ? 'approach' : 'patrol';
                this.orbitBias *= -1;
            }
        } else if (this.combatState === 'attackRun') {
            this.steerTowardPoint(this.lastKnownPos.x, this.lastKnownPos.y, this.alertSpeed, 2.2, dt, this.orbitBias * 0.18);
        } else {
            this.steerTowardPoint(
                this.lastKnownPos.x,
                this.lastKnownPos.y,
                this.alertSpeed,
                this.steering,
                dt,
                this.orbitBias * 0.34
            );
        }

        this.applyLocalAvoidance(dt, {
            avoidPlayer: this.combatState !== 'approach' || playerDistance < this.veerRadius * 1.2,
            playerRadius: this.veerRadius,
            rockForce: 390,
            shipForce: 280,
            playerForce: 520
        });
    }
}
