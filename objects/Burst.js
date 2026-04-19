// Burst — timing contact that pauses, then commits to a fast straight dash.
// Its danger is rhythm: scan to catch the pause, then dodge the dash vector.

import { Enemy } from './Enemy.js';
import { wrappedDelta } from '../utils/mathUtils.js';
import { drawBlipBrackets } from '../utils/renderUtils.js';

export class Burst extends Enemy {
    static type = 'burst';
    constructor(scene, x, y) {
        super(scene, x, y);

        this.radius = 15;
        this.body.setCircle(this.radius, -this.radius, -this.radius);

        this.driftSpeed = Phaser.Math.FloatBetween(36, 54);
        this.dashSpeed = 360;
        this.rotationRate = Phaser.Math.FloatBetween(-0.35, 0.35);
        this.alertDuration = 7.0;
        this.attackRange = 360;
        this.fireCooldown = 2.2;
        this.shotSpeed = 280;
        this.aimError = 0.16;
        this.isKamikaze = true;
        this.attackWindow = 1.9;
        this.maxSpeed = 390;
        this.scoreValue = 50;
        this.collisionDamage = 145;
        this.explosionScale = 1.7;

        this.state = 'pause';
        this.stateTimer = Phaser.Math.FloatBetween(0.8, 1.5);
        this.dashDir = { x: Math.cos(Math.random() * Math.PI * 2), y: Math.sin(Math.random() * Math.PI * 2) };
        this.setDriftVelocity();
    }

    shouldFireAt(distance) {
        return this.state !== 'dash' && super.shouldFireAt(distance);
    }

    createVisual() {
        const g = this.scene.add.graphics();

        // Split arrowhead silhouette. The reddish inner facets mark it as the dash enemy.
        g.lineStyle(1.5, 0x4dff88, 0.95);
        g.beginPath();
        g.moveTo(25, 0);
        g.lineTo(3, 12);
        g.lineTo(-12, 8);
        g.lineTo(-5, 0);
        g.lineTo(-12, -8);
        g.lineTo(3, -12);
        g.closePath();
        g.strokePath();

        g.lineStyle(0.5, 0xff3300, 0.5);
        g.lineBetween(3, -8, 3, 8);
        g.lineBetween(21, 0, -3, 0);
        g.fillStyle(0xff0000, 0.2);
        g.fillCircle(3, 0, 3.5);

        this.add(g);

        this.warningGfx = this.scene.add.graphics();
        this.add(this.warningGfx);
    }

    setDriftVelocity() {
        const angle = Math.random() * Math.PI * 2;
        this.body.setVelocity(Math.cos(angle) * this.driftSpeed, Math.sin(angle) * this.driftSpeed);
    }

    beginPause() {
        this.state = 'pause';
        this.stateTimer = Phaser.Math.FloatBetween(0.55, 1.15);
        this.body.setVelocity(this.body.velocity.x * 0.25, this.body.velocity.y * 0.25);
    }

    beginDash() {
        this.state = 'dash';
        this.stateTimer = Phaser.Math.FloatBetween(0.34, 0.48);

        if (this.lastKnownPos) {
            const dx = wrappedDelta(this.x, this.lastKnownPos.x, this.scene.worldSize);
            const dy = wrappedDelta(this.y, this.lastKnownPos.y, this.scene.worldSize);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0) this.dashDir = { x: dx / dist, y: dy / dist };
        }

        this.rotation = Math.atan2(this.dashDir.y, this.dashDir.x);
        this.body.setVelocity(this.dashDir.x * this.dashSpeed, this.dashDir.y * this.dashSpeed);
        this.scene.comms?.push?.('ram', { enemyType: this.constructor.type }, 4);
    }

    beginRecover() {
        this.state = 'recover';
        this.stateTimer = Phaser.Math.FloatBetween(0.45, 0.75);
        this.body.setVelocity(this.body.velocity.x * 0.35, this.body.velocity.y * 0.35);
    }

    updateMovement(delta) {
        const dt = delta / 1000;
        this.stateTimer -= dt;
        this.drawDashWarning();

        if (this.state === 'pause') {
            this.rotation += this.rotationRate * dt;
            if (this.isAlert && this.lastKnownPos) {
                const dx = wrappedDelta(this.x, this.lastKnownPos.x, this.scene.worldSize);
                const dy = wrappedDelta(this.y, this.lastKnownPos.y, this.scene.worldSize);
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) this.dashDir = { x: dx / dist, y: dy / dist };
                this.rotation = Math.atan2(this.dashDir.y, this.dashDir.x);
            }

            this.applyLocalAvoidance(dt, { rockForce: 260, shipForce: 180 });
            if (this.stateTimer <= 0 && this.isAlert) this.beginDash();
            return;
        }

        if (this.state === 'dash') {
            this.rotation = Math.atan2(this.body.velocity.y, this.body.velocity.x);
            this.applyLocalAvoidance(dt, { rockForce: 170, shipForce: 90 });
            if (this.stateTimer <= 0) this.beginRecover();
            return;
        }

        this.rotation += this.rotationRate * dt;
        this.applyLocalAvoidance(dt, { rockForce: 250, shipForce: 180 });
        if (this.stateTimer <= 0) {
            if (this.isAlert) this.beginPause();
            else {
                this.beginPause();
                this.setDriftVelocity();
            }
        }
    }

    drawDashWarning() {
        this.warningGfx.clear();
        if (this.state !== 'pause' || !this.isAlert || !this.isVisible || this.stateTimer > 0.55) return;

        const charge = 1 - Math.max(0, this.stateTimer / 0.55);
        const blink = 0.55 + 0.45 * Math.sin(Date.now() * 0.028);
        const alpha = (0.25 + charge * 0.6) * blink;

        drawBlipBrackets(this.warningGfx, 0, 0, 19 + charge * 5, 7, 0xff6655, alpha, 1.4);
    }
}
