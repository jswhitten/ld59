// Enemy — base class
// Handles the reveal/fade lifecycle, alert state, and shared physics setup.
// Subclasses implement createVisual() and updateMovement().
//
// Reveal: pulse sweeps through the enemy → visible for revealDuration seconds.
//   revealBrightness (0.5–1.0) scales peak alpha — weak pulses give ghostly glimpses.
//
// Alert: pulse within alertRadius → enemy knows the player's last position.
//   Alert is independent of reveal — enemies can approach or attack while invisible.

import { wrappedDelta } from '../utils/mathUtils.js';

function smoothStep(t) {
    const x = Math.max(0, Math.min(1, t));
    return x * x * (3 - 2 * x);
}

export class Enemy extends Phaser.GameObjects.Container {
    constructor(scene, x, y) {
        super(scene, x, y);
        scene.add.existing(this);
        scene.physics.add.existing(this);

        this.revealDuration  = 0.16;
        this.revealTimer     = 0;
        this.revealBrightness = 1;
        this.isDead          = false;
        this.hp              = 1;
        this.radius          = 14;
        this.scoreValue      = 10;
        this.collisionDamage = 82;
        this.explosionScale  = 1;

        this.alertDuration = 5.0;
        this.alertTimer    = 0;
        this.lastKnownPos  = null;
        this.attackRange = 500;
        this.fireCooldown = 1.5;
        this.fireTimer = Phaser.Math.FloatBetween(0.4, 1.6);
        this.shotSpeed = 280;
        this.aimError = 0.1;
        this.isCloaked = true;
        this.cloakPhase = 'cloaked';
        this.cloakTimer = 0;
        this.decloakDuration = 0.5;
        this.recloakDuration = 0.5;
        this.attackVisibleTimer = 0;
        this.attackWindow = 2.6;
        this.isKamikaze = false;
        this.combatState = 'patrol';
        this.combatTimer = 0;
        this.attackRunTime = 0.4;
        this.veerTime = 0.8;
        this.recoverTime = 0.6;
        this.veerRadius = 150;
        this.flybySide = Phaser.Math.RND.pick([-1, 1]);
        this.maxSpeed = 190;

        this.body.setCircle(this.radius, -this.radius, -this.radius);
        // No world-bounds collision — GameScene wraps entities via physics.world.wrap().

        this.setDepth(2);
        this.createVisual();
        this.postFX.addBloom(0x4dff88, 1, 1, 1.25, 2.5, 4);

        // Faint alert indicator ring drawn when alert + revealed.
        this.alertGfx = scene.add.graphics();
        this.add(this.alertGfx);

        this.cloakGfx = scene.add.graphics();
        this.add(this.cloakGfx);

        this.setAlpha(0);
    }

    // Override in subclasses to draw the wireframe contact silhouette.
    createVisual() {}

    get isRevealed() { return this.revealTimer > 0; }
    get isAlert()    { return this.alertTimer > 0; }
    get isDecloaked() { return this.cloakPhase === 'decloaked'; }
    get isVisible()  { return this.revealTimer > 0 || this.cloakAlpha > 0.02; }
    get isActuallyVisible() { return this.cloakAlpha > 0.16; }

    get cloakAlpha() {
        if (this.cloakPhase === 'decloaked') return 1;
        if (this.cloakPhase === 'decloaking') {
            return smoothStep(1 - Math.max(0, this.cloakTimer / this.decloakDuration));
        }
        if (this.cloakPhase === 'cloaking') {
            return smoothStep(Math.max(0, this.cloakTimer / this.recloakDuration));
        }
        return 0;
    }

    // brightness: 0.5–1.0 from pulse chargeLevel. Projectile reveals always pass 1.
    reveal(brightness = 1, duration = this.revealDuration) {
        this.revealTimer      = duration;
        this.revealBrightness = brightness;
    }

    // px, py: player position at the moment the pulse fired (last known position).
    alert(px, py) {
        this.alertTimer   = this.alertDuration;
        this.lastKnownPos = { x: px, y: py };
    }

    takeDamage(amount = 1) {
        this.hp -= amount;
        if (this.hp <= 0) {
            this.die();
            return true;
        }
        return false;
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;
        this.destroy();
    }

    update(delta) {
        const dt = delta / 1000;

        if (this.alertTimer > 0) this.alertTimer -= dt;
        this.fireTimer = Math.max(0, this.fireTimer - dt);
        this.combatTimer = Math.max(0, this.combatTimer - dt);
        this.updateCloak(dt);

        // Alpha: fully visible until the last 0.8 s, then fade to transparent.
        // revealBrightness scales the peak — weak pulses give a dimmer glimpse.
        let revealAlpha = 0;
        if (this.revealTimer > 0) {
            this.revealTimer -= dt;
            const fade  = Math.min(1, this.revealTimer / this.revealDuration);
            revealAlpha = Math.max(0, fade) * this.revealBrightness;
        }

        const decloakAlpha = this.cloakAlpha;
        this.setAlpha(Math.max(revealAlpha, decloakAlpha));

        // Alert indicator: faint pulsing red ring, visible only when revealed.
        this.alertGfx.clear();
        if (this.isAlert) {
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.006);
            this.alertGfx.lineStyle(1, 0xff4444, 0.28 * pulse);
            this.alertGfx.strokeCircle(0, 0, this.radius + 5);
        }
        this.drawCloakEffect();

        this.updateMovement(delta);
    }

    // Override in subclasses for type-specific movement.
    updateMovement(delta) {}

    updateCloak(dt) {
        if (this.cloakPhase === 'decloaking') {
            this.cloakTimer -= dt;
            if (this.cloakTimer <= 0) {
                this.cloakPhase = 'decloaked';
                this.cloakTimer = 0;
                this.isCloaked = false;
                this.attackVisibleTimer = this.attackWindow;
            }
            return;
        }

        if (this.cloakPhase === 'cloaking') {
            this.cloakTimer -= dt;
            if (this.cloakTimer <= 0) {
                this.cloakPhase = 'cloaked';
                this.cloakTimer = 0;
                this.isCloaked = true;
                this.attackVisibleTimer = 0;
            }
            return;
        }

        if (this.cloakPhase === 'decloaked') {
            this.attackVisibleTimer = Math.max(0, this.attackVisibleTimer - dt);
            if (this.attackVisibleTimer <= 0) this.beginRecloak();
        }
    }

    beginDecloak() {
        if (this.cloakPhase === 'decloaking' || this.cloakPhase === 'decloaked') return;
        this.cloakPhase = 'decloaking';
        this.cloakTimer = this.decloakDuration;
        this.isCloaked = true;
        this.scene.audioSystem?.playDecloak?.();
    }

    beginRecloak() {
        if (this.cloakPhase === 'cloaked' || this.cloakPhase === 'cloaking') return;
        this.cloakPhase = 'cloaking';
        this.cloakTimer = this.recloakDuration;
        this.isCloaked = true;
        this.scene.audioSystem?.playRecloak?.();
    }

    drawCloakEffect() {
        const g = this.cloakGfx;
        g.clear();
        if (this.cloakPhase !== 'decloaking' && this.cloakPhase !== 'cloaking') return;

        const duration = this.cloakPhase === 'decloaking' ? this.decloakDuration : this.recloakDuration;
        const elapsed = 1 - Math.max(0, this.cloakTimer / duration);
        const visible = this.cloakAlpha;
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.038);
        const transitionAlpha = (0.2 + Math.sin(elapsed * Math.PI) * 0.65) * (0.75 + pulse * 0.25);
        const color = this.cloakPhase === 'decloaking' ? 0x7fffdf : 0x66aaff;
        const r = this.radius + 8;
        const jitter = Math.sin(Date.now() * 0.021) * 1.5;
        const scanY = this.cloakPhase === 'decloaking'
            ? -r + elapsed * r * 2
            : r - elapsed * r * 2;
        const corner = 6;
        const half = r + 2 + jitter;

        g.lineStyle(1.2, color, transitionAlpha * 0.42);
        g.strokeCircle(0, 0, r + 4 * Math.sin(elapsed * Math.PI));

        g.lineStyle(1.4, color, transitionAlpha);
        g.lineBetween(-half, -half, -half + corner, -half);
        g.lineBetween(-half, -half, -half, -half + corner);
        g.lineBetween(half, -half, half - corner, -half);
        g.lineBetween(half, -half, half, -half + corner);
        g.lineBetween(-half, half, -half + corner, half);
        g.lineBetween(-half, half, -half, half - corner);
        g.lineBetween(half, half, half - corner, half);
        g.lineBetween(half, half, half, half - corner);

        g.lineStyle(1.1, color, transitionAlpha * (0.55 + visible * 0.35));
        g.lineBetween(-r, scanY, -r * 0.28, scanY);
        g.lineBetween(r * 0.28, scanY, r, scanY);
        g.lineStyle(1, color, transitionAlpha * 0.28);
        g.lineBetween(-r * 0.72, scanY - 5, r * 0.72, scanY - 5);
        g.lineBetween(-r * 0.72, scanY + 5, r * 0.72, scanY + 5);
    }

    shouldFireAt(distance) {
        const canAttackState = this.isKamikaze ||
            this.combatState === 'approach' ||
            this.combatState === 'attackRun';
        return this.isAlert &&
            canAttackState &&
            !this.isCloaked &&
            distance <= this.attackRange &&
            this.fireTimer <= 0;
    }

    shouldDecloakForAttack(distance) {
        const canAttackState = this.isKamikaze ||
            this.combatState === 'approach' ||
            this.combatState === 'attackRun';
        return this.isAlert &&
            canAttackState &&
            this.cloakPhase === 'cloaked' &&
            distance <= this.attackRange &&
            this.fireTimer <= 0;
    }

    markFired() {
        this.fireTimer = this.fireCooldown;
        if (!this.isKamikaze) {
            this.combatState = 'attackRun';
            this.combatTimer = this.attackRunTime;
        }
        this.reveal(0.95, Math.max(this.revealDuration, 0.22));
    }

    wrappedVectorTo(x, y) {
        return {
            x: wrappedDelta(this.x, x, this.scene.worldSize),
            y: wrappedDelta(this.y, y, this.scene.worldSize)
        };
    }

    steerTowardPoint(x, y, speed, responsiveness, dt, sideBias = 0) {
        const v = this.wrappedVectorTo(x, y);
        const dist = Math.sqrt(v.x * v.x + v.y * v.y);
        if (dist <= 0.001) return dist;

        let nx = v.x / dist;
        let ny = v.y / dist;
        if (sideBias !== 0) {
            const baseX = nx;
            const baseY = ny;
            nx += -baseY * sideBias;
            ny += baseX * sideBias;
            const mag = Math.sqrt(nx * nx + ny * ny);
            if (mag > 0.001) {
                nx /= mag;
                ny /= mag;
            }
        }

        this.blendVelocity(nx * speed, ny * speed, responsiveness, dt);
        return dist;
    }

    steerAwayFromPoint(x, y, speed, responsiveness, dt, sideBias = 0) {
        const v = this.wrappedVectorTo(x, y);
        const dist = Math.sqrt(v.x * v.x + v.y * v.y);
        if (dist <= 0.001) return dist;

        let nx = -v.x / dist;
        let ny = -v.y / dist;
        if (sideBias !== 0) {
            const baseX = nx;
            const baseY = ny;
            nx += -baseY * sideBias;
            ny += baseX * sideBias;
            const mag = Math.sqrt(nx * nx + ny * ny);
            if (mag > 0.001) {
                nx /= mag;
                ny /= mag;
            }
        }

        this.blendVelocity(nx * speed, ny * speed, responsiveness, dt);
        return dist;
    }

    blendVelocity(targetVX, targetVY, responsiveness, dt) {
        const blend = Math.min(1, responsiveness * dt);
        this.body.velocity.x += (targetVX - this.body.velocity.x) * blend;
        this.body.velocity.y += (targetVY - this.body.velocity.y) * blend;
    }

    applyLocalAvoidance(dt, options = {}) {
        const {
            avoidPlayer = false,
            playerRadius = this.veerRadius,
            rockForce = 360,
            shipForce = 250,
            playerForce = 420
        } = options;

        let forceX = 0;
        let forceY = 0;
        const vx = this.body.velocity.x;
        const vy = this.body.velocity.y;
        const speed = Math.sqrt(vx * vx + vy * vy);
        const forwardX = speed > 1 ? vx / speed : Math.cos(this.rotation);
        const forwardY = speed > 1 ? vy / speed : Math.sin(this.rotation);

        for (const rock of this.scene.asteroids ?? []) {
            if (rock.isDead) continue;
            const v = this.wrappedVectorTo(rock.x, rock.y);
            const dist = Math.sqrt(v.x * v.x + v.y * v.y);
            const weight = rock.isMeteoroid ? 0.25 : 1;
            const avoidRadius = rock.radius + (rock.isMeteoroid ? 42 : 95 + Math.min(95, speed * 0.42));
            if (dist <= 0.001 || dist >= avoidRadius) continue;

            const nx = v.x / dist;
            const ny = v.y / dist;
            const forwardDot = nx * forwardX + ny * forwardY;
            if (forwardDot < -0.2 && dist > rock.radius + this.radius + 34) continue;

            const strength = (1 - dist / avoidRadius) * weight;
            forceX -= nx * strength * rockForce;
            forceY -= ny * strength * rockForce;
        }

        for (const other of this.scene.enemies ?? []) {
            if (other === this || other.isDead) continue;
            const v = this.wrappedVectorTo(other.x, other.y);
            const dist = Math.sqrt(v.x * v.x + v.y * v.y);
            const avoidRadius = this.radius + (other.radius ?? 14) + 42;
            if (dist <= 0.001 || dist >= avoidRadius) continue;

            const strength = 1 - dist / avoidRadius;
            forceX -= (v.x / dist) * strength * shipForce;
            forceY -= (v.y / dist) * strength * shipForce;
        }

        if (avoidPlayer && this.scene.player) {
            const v = this.wrappedVectorTo(this.scene.player.x, this.scene.player.y);
            const dist = Math.sqrt(v.x * v.x + v.y * v.y);
            if (dist > 0.001 && dist < playerRadius) {
                const strength = 1 - dist / playerRadius;
                const awayX = -v.x / dist;
                const awayY = -v.y / dist;
                forceX += (awayX + -awayY * this.flybySide * 0.45) * strength * playerForce;
                forceY += (awayY + awayX * this.flybySide * 0.45) * strength * playerForce;
            }
        }

        this.body.velocity.x += forceX * dt;
        this.body.velocity.y += forceY * dt;
        this.clampSpeed();
    }

    clampSpeed(maxSpeed = this.maxSpeed) {
        const vx = this.body.velocity.x;
        const vy = this.body.velocity.y;
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed <= maxSpeed || speed <= 0.001) return;
        this.body.velocity.x = (vx / speed) * maxSpeed;
        this.body.velocity.y = (vy / speed) * maxSpeed;
    }
}
