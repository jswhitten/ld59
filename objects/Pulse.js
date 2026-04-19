// Pulse
// An expanding ring of energy that propagates from the player's position.
// chargeLevel (0–1) scales range, speed, reveal brightness, and alert radius.
// Low charge = short quiet whisper; full charge = wide loud sweep that summons everything.

import { wrappedDelta, wrappedDist } from '../utils/mathUtils.js';
import { EchoRing } from './EchoRing.js';

export class Pulse {
    constructor(scene, x, y, chargeLevel = 1) {
        this.scene = scene;
        this.originX = x;   // player position at fire time — used as last-known-pos for alerts
        this.originY = y;
        this.chargeLevel = chargeLevel;

        // All pulse properties scale continuously with charge.
        this.maxRadius       = 260 + 1900 * chargeLevel;   // 260–2160 px
        this.speed           = 850 + 550 * chargeLevel;    // 850–1400 px/s
        this.alertRadius     = this.maxRadius * chargeLevel; // 0 at min → maxRadius at full
        this.revealBrightness = 0.5 + 0.5 * chargeLevel;   // 0.5–1.0

        this.currentRadius = 10;
        this.prevRadius    = 0;
        this.done          = false;

        this.gfx = scene.add.graphics();
        this.gfx.setDepth(5);

        this.pingedEnemies = new Set();
        this.pingedAsteroids = new Set();
    }

    update(delta, enemies, asteroids = []) {
        const dt = delta / 1000;
        this.prevRadius = this.currentRadius;
        this.currentRadius += this.speed * dt;

        const worldSize = this.scene.worldSize;
        const tolerance = 30;

        for (const enemy of enemies) {
            if (enemy.isDead) continue;
            const d = wrappedDist(this.originX, this.originY, enemy.x, enemy.y, worldSize);
            if (d >= this.prevRadius - tolerance && d <= this.currentRadius + tolerance) {
                enemy.reveal(this.revealBrightness);
                if (!this.pingedEnemies.has(enemy)) {
                    this.pingedEnemies.add(enemy);
                    this.scene.addSignalBlip(enemy.x, enemy.y, 'ship', this.revealBrightness, enemy.radius, enemy);
                    // Visual echo ring at contact position.
                    this.scene.echoRings?.push(new EchoRing(this.scene, enemy.x, enemy.y, this.revealBrightness * 0.9));
                    // Audio echo: distance-delayed, stereo-panned return ping. Cap at 5 per pulse.
                    if (this.pingedEnemies.size <= 5 && this.scene.audioSystem) {
                        const edx = wrappedDelta(this.originX, enemy.x, worldSize);
                        const edy = wrappedDelta(this.originY, enemy.y, worldSize);
                        this.scene.audioSystem.playPulseEcho(edx, edy, d, this.chargeLevel);
                    }
                    if (this.pingedEnemies.size === 3) {
                        this.scene.comms?.push?.('multiContact', { count: this.pingedEnemies.size }, 2);
                    }
                }
                // Alert enemies within the alert radius — small pulses spare distant contacts.
                if (d <= this.alertRadius) {
                    enemy.alert(this.originX, this.originY);
                }
            }
        }

        for (const asteroid of asteroids) {
            if (asteroid.isDead) continue;
            if (asteroid.isMeteoroid) continue;
            const d = wrappedDist(this.originX, this.originY, asteroid.x, asteroid.y, worldSize);
            if (d >= this.prevRadius - asteroid.radius && d <= this.currentRadius + asteroid.radius) {
                const revealStrength = 0.72 + 0.2 * this.chargeLevel;
                if (!this.pingedAsteroids.has(asteroid)) {
                    this.pingedAsteroids.add(asteroid);
                    // Visual echo ring — slightly dimmer than enemy echoes (rock, not contact)
                    this.scene.echoRings?.push(new EchoRing(this.scene, asteroid.x, asteroid.y, revealStrength * 0.6));
                    // Audio echo — lower chargeLevel makes it shorter and lower-frequency than ship echoes
                    if (this.scene.audioSystem) {
                        const adx = wrappedDelta(this.originX, asteroid.x, worldSize);
                        const ady = wrappedDelta(this.originY, asteroid.y, worldSize);
                        this.scene.audioSystem.playPulseEcho(adx, ady, d, this.chargeLevel * 0.5);
                    }
                }
            }
        }

        this.gfx.clear();
        const t = this.currentRadius / this.maxRadius;
        const alpha = Math.pow(1 - t, 0.5) * 0.95;

        if (alpha > 0.01) {
            for (const layer of [
                { offset: -38, width: 10, alpha: 0.3 },
                { offset:   0, width: 18, alpha: 0.6 },
                { offset:  28, width: 10, alpha: 0.5 },
            ]) {
                const r = this.currentRadius + layer.offset;
                if (r <= 0) continue;
                this.gfx.lineStyle(layer.width, 0x7fffdf, alpha * layer.alpha);
                this.gfx.strokeCircle(this.originX, this.originY, r);
            }
        }

        if (this.currentRadius >= this.maxRadius) {
            this.done = true;
            this.gfx.destroy();
        }
    }

    destroy() {
        if (this.gfx && this.gfx.active) this.gfx.destroy();
        this.done = true;
    }
}
