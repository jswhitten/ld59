// GameScene — core gameplay
// Owns the world, player, enemies, projectiles, and pulses.
// Input: movement → Player; pulse charging + fire → here via EnergySystem.

import { Player }       from '../objects/Player.js';
import { Pulse }        from '../objects/Pulse.js';
import { Projectile }   from '../objects/Projectile.js';
import { EnemyProjectile } from '../objects/EnemyProjectile.js';
import { Drifter }      from '../objects/Drifter.js';
import { Seeker }       from '../objects/Seeker.js';
import { Burst }        from '../objects/Burst.js';
import { Asteroid }     from '../objects/Asteroid.js';
import { EnergySystem } from '../systems/EnergySystem.js';
import { AudioSystem }  from '../systems/AudioSystem.js';
import { CommsSystem }  from '../systems/CommsSystem.js';
import { submitHighScore, loadHighScores } from '../utils/highScores.js';
import { wrappedDelta, wrappedDist } from '../utils/mathUtils.js';
import { drawBlipBrackets } from '../utils/renderUtils.js';

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    create() {
        // UIScene is launched once and never restarted — it reads game state via scene.get('GameScene').
        if (!this.scene.isActive('UIScene')) this.scene.launch('UIScene');

        this.worldSize = 5000;
        const half = this.worldSize / 2;
        this.physics.world.setBounds(-half, -half, this.worldSize, this.worldSize);

        this.createStarField();

        // Energy system — created before player so UIScene can read it immediately.
        this.energy = new EnergySystem();
        this.audioSystem = new AudioSystem(this);
        this.events.once('shutdown', () => this.audioSystem?.destroy());
        this.comms = new CommsSystem(this);

        // Player
        this.player = new Player(this, 0, 0);

        // Camera is manually centered each frame. Smooth follow lerps across the
        // numeric wrap seam, which makes the player visibly jump at world edges.
        this.cameras.main.setBackgroundColor('#020610');
        // WebGL only — Canvas renderer (Safari iOS, some Chromebooks) silently ignores postFX.
        this.cameras.main.postFX.addBloom(0xffffff, 0, 0, 1, 0.6, 4);
        this.centerCameraOnPlayer();

        // Input
        this.cursors  = this.input.keyboard.createCursorKeys();
        this.wasd     = this.input.keyboard.addKeys({
            up:    Phaser.Input.Keyboard.KeyCodes.W,
            down:  Phaser.Input.Keyboard.KeyCodes.S,
            left:  Phaser.Input.Keyboard.KeyCodes.A,
            right: Phaser.Input.Keyboard.KeyCodes.D
        });
        this.shiftKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
        this.enterKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
        this.input.keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.F2);
        this.input.keyboard.on('keydown-F2', event => {
            event.preventDefault();
            this.spawnDebugEnemyCluster();
        });

        // Game object pools
        this.pulses      = [];
        this.projectiles = [];
        this.enemyProjectiles = [];
        this.enemies     = [];
        this.asteroids   = [];
        this.echoRings   = [];
        this.radarBlips  = [];
        this.worldBlips  = [];
        this.worldBlipGfx = this.add.graphics().setDepth(6);
        this.playerShieldGfx = this.add.graphics();
        this.playerShieldGfx.setBlendMode(Phaser.BlendModes.ADD);
        this.player.addAt(this.playerShieldGfx, 0);
        this.damageParticles = [];
        this.damageParticleGfx = this.add.graphics().setDepth(9);
        this.damageParticleTimer = 0;

        // Short cooldowns — rate limiters, not the primary energy limiter.
        this.shotCooldown  = 0;
        this.pulseCooldown = 0; // 0.15 s key-bounce guard after firing

        this.score = 0;
        this.hitStreak = 0;
        this.multiplier = 1;
        this.maxHull = 3;
        this.hull = this.maxHull;
        this.hullDamage = 0;
        this.invulnTimer = 0;
        this.shieldHitFlash = 0;
        this.hullHitFlash = 0;
        this.gameOver = false;
        this.highScoreSubmitted = false;
        this.highScoreResult = null;
        this.underAttackTimer = 0;
        this.survivalTime = 0;
        this.spawnTimer = 4;
        this.enemyDetectionRange = 420;
        this.shieldDamagePerHit = 72;
        this.meteoroidDamagePerHit = 22;
        this.asteroidDamageMin = 45;
        this.asteroidDamageMax = 72;
        this.enemyShotDamage = 42;
        this.lowShieldLeakThreshold = 0.25;
        this.lastStarPlayerX = this.player.x;
        this.lastStarPlayerY = this.player.y;

        this.spawnAsteroids(30);
        this.spawnMeteoroids(55);
        this.spawnInitialEnemies();
    }

    // Explicit contract for UIScene — reading any property here will give a clear error on rename.
    getUIState() {
        return {
            score:          this.score,
            multiplier:     this.multiplier,
            survivalTime:   this.survivalTime,
            gameOver:       this.gameOver,
            hull:           this.hull,
            maxHull:        this.maxHull,
            shieldHitFlash: this.shieldHitFlash,
            hullHitFlash:   this.hullHitFlash,
            energy:         this.energy,
            worldSize:      this.worldSize,
            player: {
                x:           this.player.x,
                y:           this.player.y,
                thrustInput: this.player.thrustInput ?? 0,
                vx:          this.player.body.velocity.x,
                vy:          this.player.body.velocity.y,
            },
            pulses:         this.pulses,
            echoRings:      this.echoRings,
            radarBlips:     this.radarBlips,
            enemies:        this.enemies,
            audioSystem:    this.audioSystem,
            comms:          this.comms.getCurrentMessage(),
            cam:            this.cameras.main,
            highScores:     this.highScoreResult?.scores ?? loadHighScores(),
            newHighScoreRank: this.highScoreResult?.rank ?? null,
        };
    }

    spawnAsteroids(count) {
        const half = this.worldSize / 2 - 180;
        for (let i = 0; i < count; i++) {
            const radius = Math.round(16 + Math.pow(Math.random(), 2.15) * 58);
            let x = 0;
            let y = 0;
            let attempts = 0;

            do {
                x = Phaser.Math.Between(-half, half);
                y = Phaser.Math.Between(-half, half);
                attempts += 1;
            } while ((wrappedDist(x, y, this.player.x, this.player.y, this.worldSize) < 420 ||
                     this.asteroids.some(a => wrappedDist(x, y, a.x, a.y, this.worldSize) < radius + a.radius + 70)) &&
                     attempts < 50);

            this.addAsteroid(x, y, radius);
        }
    }

    spawnMeteoroids(count) {
        const half = this.worldSize / 2 - 120;
        for (let i = 0; i < count; i++) {
            this.addAsteroid(
                Phaser.Math.Between(-half, half),
                Phaser.Math.Between(-half, half),
                Phaser.Math.Between(3, 8)
            );
        }
    }

    addAsteroid(x, y, radius) {
        const asteroid = new Asteroid(this, x, y, radius);
        this.asteroids.push(asteroid);
        return asteroid;
    }

    spawnInitialEnemies() {
        for (let i = 0; i < 12; i++) this.spawnEnemyAwayFromPlayer(Drifter, 500);
        for (let i = 0; i < 2; i++) this.spawnEnemyAwayFromPlayer(Seeker, 700);
    }

    spawnEnemyAwayFromPlayer(EnemyClass = Drifter, minDistance = 700) {
        const half = this.worldSize / 2 - 150;
        let x = 0;
        let y = 0;
        let attempts = 0;

        do {
            x = Phaser.Math.Between(-half, half);
            y = Phaser.Math.Between(-half, half);
            attempts += 1;
        } while (this.player &&
                 wrappedDist(x, y, this.player.x, this.player.y, this.worldSize) < minDistance &&
                 attempts < 50);

        const enemy = new EnemyClass(this, x, y);
        this.enemies.push(enemy);
        return enemy;
    }

    spawnDebugEnemyCluster() {
        if (!this.player || this.gameOver) return;
        const types = [Drifter, Seeker, Burst, Drifter, Seeker, Burst];
        const half = this.worldSize / 2;

        for (let i = 0; i < types.length; i++) {
            const angle = -Math.PI / 2 + i * Math.PI * 2 / types.length;
            const radius = 360 + (i % 2) * 70;
            const wrap = value => Phaser.Math.Wrap(value + half, 0, this.worldSize) - half;
            const enemy = new types[i](
                this,
                wrap(this.player.x + Math.cos(angle) * radius),
                wrap(this.player.y + Math.sin(angle) * radius)
            );
            enemy.alert(this.player.x, this.player.y);
            this.enemies.push(enemy);
        }
    }

    chooseEnemyType() {
        const t = this.survivalTime;
        if (t < 25) return Drifter;

        if (t >= 70) {
            const burstChance = Math.min(0.22, 0.05 + (t - 70) * 0.0025);
            if (Math.random() < burstChance) return Burst;
        }

        const seekerChance = Math.min(0.58, 0.18 + (t - 25) * 0.006);
        return Math.random() < seekerChance ? Seeker : Drifter;
    }

    update(time, delta) {
        const dt = delta / 1000;

        if (this.gameOver) {
            this.shieldHitFlash = Math.max(0, this.shieldHitFlash - dt);
            this.hullHitFlash = Math.max(0, this.hullHitFlash - dt);
            this.updatePlayerShieldVisual(false);
            this.updateDamageParticles(dt, false);
            if (Phaser.Input.Keyboard.JustDown(this.restartKey) ||
                Phaser.Input.Keyboard.JustDown(this.enterKey)) {
                this.scene.restart();
            }
            return;
        }

        this.survivalTime += dt;
        this.comms.update(dt, this);
        this.updateRadarBlips(dt);
        this.updateWorldBlips(dt);
        this.invulnTimer = Math.max(0, this.invulnTimer - dt);
        this.shieldHitFlash = Math.max(0, this.shieldHitFlash - dt);
        this.hullHitFlash = Math.max(0, this.hullHitFlash - dt);
        this.player.setAlpha(this.invulnTimer > 0 ? 0.45 + 0.35 * Math.sin(time * 0.025) : 1);
        this.updateSpawning(dt);

        // --- Player movement + wrap ---
        this.player.update(this.cursors, this.wasd, delta);
        this.physics.world.wrap(this.player, 16);
        this.updatePlayerShieldVisual(true);
        this.updateDamageParticles(dt, true);
        this.updateStarParallax(
            wrappedDelta(this.lastStarPlayerX, this.player.x, this.worldSize),
            wrappedDelta(this.lastStarPlayerY, this.player.y, this.worldSize)
        );
        this.lastStarPlayerX = this.player.x;
        this.lastStarPlayerY = this.player.y;
        this.centerCameraOnPlayer();

        // --- Energy ---
        // isCharging reflects key state this frame; EnergySystem reads it in update().
        this.energy.isCharging = this.spaceKey.isDown;
        this.energy.update(delta);
        this.underAttackTimer = Math.max(0, this.underAttackTimer - dt);
        const isCritical = this.hull <= 1 || this.energy.shieldFraction < 0.18;
        this.audioSystem.update(delta, {
            gameOver:       this.gameOver,
            capFraction:    this.energy.capFraction,
            spaceKeyIsDown: this.spaceKey.isDown,
            playerThrust:   this.player.thrustInput ?? 0,
            playerX:        this.player.x,
            playerY:        this.player.y,
            playerVX:       this.player.body.velocity.x,
            playerVY:       this.player.body.velocity.y,
            worldSize:      this.worldSize,
            enemies:        this.enemies,
            shieldFraction: this.energy.shieldFraction,
            underAttack:    this.underAttackTimer > 0,
            critical:       isCritical,
        });

        // --- Cooldowns ---
        this.shotCooldown  = Math.max(0, this.shotCooldown  - dt);
        this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);

        // --- Fire (Shift, held, rate-limited + energy-gated) ---
        if (this.shiftKey.isDown && this.shotCooldown <= 0 && this.energy.canShoot()) {
            this.fireProjectile();
            this.energy.consumeShot();
            this.audioSystem.playShot();
            this.shotCooldown = 0.22;
        }

        // --- Pulse (Space release fires at accumulated charge) ---
        if (Phaser.Input.Keyboard.JustUp(this.spaceKey) && this.pulseCooldown <= 0) {
            const charge      = this.energy.releaseCharge(); // 0–100
            const chargeLevel = charge / 100;
            if (chargeLevel > 0.05) {                        // ignore sub-threshold taps
                this.firePulse(chargeLevel);
                this.pulseCooldown = 0.15;                   // key-bounce guard only
            }
        }

        // --- Pulses ---
        for (let i = this.pulses.length - 1; i >= 0; i--) {
            const p = this.pulses[i];
            p.update(delta, this.enemies, this.asteroids);
            if (p.done) this.pulses.splice(i, 1);
        }

        // --- Echo rings ---
        for (let i = this.echoRings.length - 1; i >= 0; i--) {
            this.echoRings[i].update(delta);
            if (this.echoRings[i].done) this.echoRings.splice(i, 1);
        }

        // --- Projectiles + hit detection ---
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            if (proj.isDead) { this.projectiles.splice(i, 1); continue; }

            proj.update(delta, this.enemies);
            this.physics.world.wrap(proj, 8);

            for (const asteroid of this.asteroids) {
                if (asteroid.isDead) continue;
                if (asteroid.isMeteoroid) continue;
                const d = wrappedDist(proj.x, proj.y, asteroid.x, asteroid.y, this.worldSize);
                if (d < asteroid.radius + 4) {
                    proj.die();
                    break;
                }
            }
            if (proj.isDead) continue;

            for (const enemy of this.enemies) {
                if (enemy.isDead) continue;
                const d = wrappedDist(proj.x, proj.y, enemy.x, enemy.y, this.worldSize);
                if (d < enemy.radius + 4) {
                    const wasBlind = !enemy.isVisible;
                    const hitX = enemy.x;
                    const hitY = enemy.y;
                    if (proj.hitEnemy(enemy)) {
                        this.awardKill(hitX, hitY, wasBlind, enemy);
                    }
                    break;
                }
            }
        }

        // --- Enemy projectiles ---
        for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
            const proj = this.enemyProjectiles[i];
            if (proj.isDead) { this.enemyProjectiles.splice(i, 1); continue; }

            proj.update(delta);
            this.physics.world.wrap(proj, 8);

            let blocked = false;
            for (const asteroid of this.asteroids) {
                if (asteroid.isDead || asteroid.isMeteoroid) continue;
                const d = wrappedDist(proj.x, proj.y, asteroid.x, asteroid.y, this.worldSize);
                if (d < asteroid.radius + proj.radius) {
                    proj.die();
                    blocked = true;
                    break;
                }
            }
            if (blocked) continue;

            const playerHit = wrappedDist(proj.x, proj.y, this.player.x, this.player.y, this.worldSize);
            if (playerHit < 12 + proj.radius) {
                proj.die();
                this.damagePlayer({
                    shieldDamage: this.enemyShotDamage,
                    shieldInvuln: 0.45,
                    hullInvuln: 0.9,
                    shieldShake: 0.0035,
                    hullShake: 0.0055
                });
            }
        }

        // --- Asteroids ---
        for (let i = this.asteroids.length - 1; i >= 0; i--) {
            const asteroid = this.asteroids[i];
            if (asteroid.isDead) { this.asteroids.splice(i, 1); continue; }
            asteroid.update(delta);
            this.physics.world.wrap(asteroid, asteroid.radius);
        }
        this.handleAsteroidCollisions();

        // --- Enemies ---
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (enemy.isDead) { this.enemies.splice(i, 1); continue; }

            const playerDistance = wrappedDist(this.player.x, this.player.y, enemy.x, enemy.y, this.worldSize);
            if (playerDistance <= (enemy.detectionRange ?? this.enemyDetectionRange)) {
                enemy.alert(this.player.x, this.player.y);
            }

            enemy.update(delta);
            this.physics.world.wrap(enemy, 16);
            this.tryEnemyFire(enemy, playerDistance);
        }

        this.handleShipRockCollisions();
        this.handleShipShipCollisions();
        this.handlePlayerEnemyCollisions();
    }

    fireProjectile() {
        this.projectiles.push(
            new Projectile(this, this.player.x, this.player.y, this.player.facing)
        );
    }

    fireEnemyProjectile(enemy, angle) {
        const muzzleOffset = (enemy.radius ?? 14) + 8;
        const shotX = enemy.x + Math.cos(angle) * muzzleOffset;
        const shotY = enemy.y + Math.sin(angle) * muzzleOffset;
        this.enemyProjectiles.push(
            new EnemyProjectile(this, shotX, shotY, angle, enemy.shotSpeed ?? 280)
        );
        this.createEnemyMuzzleFlash(enemy.x, enemy.y, angle);
        this.audioSystem.playEnemyShot?.();
        this.underAttackTimer = Math.max(this.underAttackTimer, 5.5);
    }

    tryEnemyFire(enemy, playerDistance) {
        if (enemy.shouldDecloakForAttack?.(playerDistance)) {
            enemy.beginDecloak?.();
            this.comms.push(enemy.isKamikaze ? 'ram' : 'attack', {
                enemyType: enemy.constructor.type
            }, enemy.isKamikaze ? 4 : 3);
            return;
        }

        if (!enemy.shouldFireAt?.(playerDistance)) return;

        const dx = wrappedDelta(enemy.x, this.player.x, this.worldSize);
        const dy = wrappedDelta(enemy.y, this.player.y, this.worldSize);
        const aimError = enemy.aimError ?? 0.1;
        const angle = Math.atan2(dy, dx) + Phaser.Math.FloatBetween(-aimError, aimError);

        this.fireEnemyProjectile(enemy, angle);
        enemy.markFired?.();
    }

    firePulse(chargeLevel = 1) {
        this.pulses.push(new Pulse(this, this.player.x, this.player.y, chargeLevel));
        this.audioSystem.playPulse(chargeLevel);
    }

    addRadarBlip(x, y, type, strength = 1, radius = 14, source = null) {
        this.radarBlips.push({
            x,
            y,
            type,
            strength,
            radius,
            source,
            age: 0,
            snap: 0.28,
            lifetime: type === 'ship' ? 4.2 : 5.5
        });
    }

    addCommsBlip(x, y, strength = 0.7) {
        const lifetime = 3.5;
        const blip = { x, y, type: 'comms', strength, radius: 14, source: null, age: 0, snap: 0.28, lifetime };
        this.radarBlips.push({ ...blip });
        this.worldBlips.push({ ...blip });
    }

    addSignalBlip(x, y, type, strength = 1, radius = 14, source = null) {
        this.addRadarBlip(x, y, type, strength, radius, source);
        this.worldBlips.push({
            x,
            y,
            type,
            strength,
            radius,
            source,
            age: 0,
            snap: 0.28,
            lifetime: type === 'ship' ? 2.4 : 3.2
        });
    }

    updateRadarBlips(dt) {
        for (let i = this.radarBlips.length - 1; i >= 0; i--) {
            const blip = this.radarBlips[i];
            blip.age += dt;
            if (this.shouldClearBlip(blip) || blip.age >= blip.lifetime) {
                this.radarBlips.splice(i, 1);
            }
        }
    }

    updateWorldBlips(dt) {
        const g = this.worldBlipGfx;
        g.clear();

        for (let i = this.worldBlips.length - 1; i >= 0; i--) {
            const blip = this.worldBlips[i];
            blip.age += dt;
            if (this.shouldClearBlip(blip) || blip.age >= blip.lifetime) {
                this.worldBlips.splice(i, 1);
                continue;
            }

            const life = 1 - blip.age / blip.lifetime;
            const snap = Math.max(0, 1 - blip.age / blip.snap);
            const alpha = Math.min(1, Math.max(0, life) * blip.strength + snap * 0.45);
            const blipColor = blip.type === 'comms' ? 0xff3344 : 0x4dff88;
            drawBlipBrackets(g, blip.x, blip.y, 12 + snap * 4, 5, blipColor, alpha * 0.72);
        }
    }

    shouldClearBlip(blip) {
        if (blip.type !== 'ship' || !blip.source) return false;
        return blip.source.isDead || blip.source.isActuallyVisible;
    }

    updatePlayerShieldVisual(shouldDraw) {
        const g = this.playerShieldGfx;
        g.clear();
        if (!shouldDraw || !this.player?.visible || !this.energy) return;

        const shieldFraction = Math.max(0, Math.min(1, this.energy.shieldFraction));
        const hitFlash = Math.max(0, Math.min(1, this.shieldHitFlash / 0.34));
        const intensity = Math.max(shieldFraction * 0.34, hitFlash * 0.82);
        if (intensity <= 0.015) return;

        const x = 0;
        const y = 0;
        const pulse = 0.5 + 0.5 * Math.sin(this.time.now * 0.006);
        const radius = 24 + shieldFraction * 4 + hitFlash * 7;
        const edgeAlpha = Math.min(0.56, 0.055 + intensity * 0.36 + hitFlash * 0.18);
        const fillAlpha = Math.min(0.11, 0.012 + shieldFraction * 0.04 + hitFlash * 0.055);

        // Faint interior volume, with most brightness reserved for the rim.
        g.fillStyle(0x66aaff, fillAlpha * 0.54);
        g.fillCircle(x, y, radius * 1.08);
        g.fillStyle(0x66aaff, fillAlpha);
        g.fillCircle(x, y, radius * 0.92);
        g.fillStyle(0x8fd6ff, fillAlpha * 0.42);
        g.fillCircle(x - radius * 0.16, y - radius * 0.22, radius * 0.34);

        const layers = 7;
        for (let i = 0; i < layers; i++) {
            const t = i / (layers - 1);
            const r = radius - 7 + t * 10 + pulse * (1 - t) * 0.9;
            const alpha = edgeAlpha * Math.pow(t, 1.85) * (0.42 + pulse * 0.12);
            const width = 0.8 + t * 1.45 + hitFlash * 0.9;
            const color = i > layers - 3 ? 0x9fe8ff : 0x448cff;
            g.lineStyle(width, color, alpha);
            g.strokeCircle(x, y, r);
        }

        if (hitFlash > 0.02) {
            g.lineStyle(1.8 + hitFlash * 1.5, 0xd8f6ff, hitFlash * 0.42);
            g.strokeCircle(x, y, radius + 3 + hitFlash * 5);
        }
    }

    updateDamageParticles(dt, shouldEmit) {
        if (shouldEmit && this.player?.visible) this.emitDamageParticles(dt);

        const g = this.damageParticleGfx;
        g.clear();

        for (let i = this.damageParticles.length - 1; i >= 0; i--) {
            const p = this.damageParticles[i];
            p.age += dt;
            if (p.age >= p.lifetime) {
                this.damageParticles.splice(i, 1);
                continue;
            }

            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= Math.pow(p.drag, dt * 60);
            p.vy *= Math.pow(p.drag, dt * 60);
            p.vy -= p.lift * dt;

            const life = 1 - p.age / p.lifetime;
            if (p.type === 'smoke') {
                const size = p.size * (1 + p.age * 1.35);
                g.fillStyle(0x879098, life * p.alpha);
                g.fillCircle(p.x, p.y, size);
                g.fillStyle(0x28313a, life * p.alpha * 0.45);
                g.fillCircle(p.x + size * 0.18, p.y - size * 0.08, size * 0.68);
            } else {
                const len = p.size * (1.8 + life * 2.2);
                const speed = Math.max(1, Math.hypot(p.vx, p.vy));
                const nx = p.vx / speed;
                const ny = p.vy / speed;
                g.lineStyle(1.4, p.color, life * p.alpha);
                g.lineBetween(p.x, p.y, p.x - nx * len, p.y - ny * len);
                g.fillStyle(0xffeeaa, life * p.alpha * 0.75);
                g.fillCircle(p.x, p.y, Math.max(1, p.size * 0.32));
            }
        }
    }

    emitDamageParticles(dt) {
        const hullFraction = this.maxHull > 0 ? this.hull / this.maxHull : 0;
        if (hullFraction > 0.68) {
            this.damageParticleTimer = 0;
            return;
        }

        const severity = Phaser.Math.Clamp((0.68 - hullFraction) / 0.68, 0, 1);
        const rate = 2.5 + severity * 12;
        this.damageParticleTimer += dt * rate;

        while (this.damageParticleTimer >= 1) {
            this.damageParticleTimer -= 1;
            this.spawnDamageSmoke(severity);
            if (Math.random() < 0.35 + severity * 0.42) this.spawnDamageSpark(severity);
        }
    }

    spawnDamageSmoke(severity) {
        const origin = this.damageEmitterOrigin();
        const driftAngle = this.player.facing + Math.PI + Phaser.Math.FloatBetween(-0.95, 0.95);
        const speed = Phaser.Math.FloatBetween(8, 26 + severity * 22);
        const playerVX = this.player.body.velocity.x;
        const playerVY = this.player.body.velocity.y;

        this.damageParticles.push({
            type: 'smoke',
            x: origin.x,
            y: origin.y,
            vx: Math.cos(driftAngle) * speed + playerVX * 0.10 + Phaser.Math.FloatBetween(-10, 10),
            vy: Math.sin(driftAngle) * speed + playerVY * 0.10 + Phaser.Math.FloatBetween(-10, 10),
            drag: 0.985,
            lift: Phaser.Math.FloatBetween(2, 10),
            size: Phaser.Math.FloatBetween(2.4, 4.2 + severity * 2.8),
            alpha: Phaser.Math.FloatBetween(0.12, 0.26 + severity * 0.18),
            age: 0,
            lifetime: Phaser.Math.FloatBetween(0.9, 1.7 + severity * 0.5)
        });
    }

    spawnDamageSpark(severity) {
        const origin = this.damageEmitterOrigin();
        const angle = this.player.facing + Math.PI + Phaser.Math.FloatBetween(-1.4, 1.4);
        const speed = Phaser.Math.FloatBetween(45, 110 + severity * 75);
        const color = Math.random() < 0.68 ? 0xffcc66 : 0xff6644;

        this.damageParticles.push({
            type: 'spark',
            x: origin.x,
            y: origin.y,
            vx: Math.cos(angle) * speed + this.player.body.velocity.x * 0.06,
            vy: Math.sin(angle) * speed + this.player.body.velocity.y * 0.06,
            drag: 0.955,
            lift: 0,
            size: Phaser.Math.FloatBetween(1.5, 3.1 + severity * 1.5),
            alpha: Phaser.Math.FloatBetween(0.55, 0.95),
            color,
            age: 0,
            lifetime: Phaser.Math.FloatBetween(0.16, 0.36 + severity * 0.16)
        });
    }

    damageEmitterOrigin() {
        const back = -8 + Phaser.Math.FloatBetween(-4, 3);
        const side = Phaser.Math.FloatBetween(-6, 6);
        const c = Math.cos(this.player.facing);
        const s = Math.sin(this.player.facing);
        return {
            x: this.player.x + c * back - s * side,
            y: this.player.y + s * back + c * side
        };
    }

    handleAsteroidCollisions() {
        for (let i = 0; i < this.asteroids.length; i++) {
            const a = this.asteroids[i];
            if (a.isDead) continue;

            for (let j = i + 1; j < this.asteroids.length; j++) {
                const b = this.asteroids[j];
                if (b.isDead) continue;
                if (a.isMeteoroid && b.isMeteoroid) continue;

                let dx = wrappedDelta(a.x, b.x, this.worldSize);
                let dy = wrappedDelta(a.y, b.y, this.worldSize);
                let dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = a.radius + b.radius;
                if (dist >= minDist) continue;

                if (dist <= 0.001) {
                    const angle = Math.random() * Math.PI * 2;
                    dx = Math.cos(angle);
                    dy = Math.sin(angle);
                    dist = 1;
                }

                const nx = dx / dist;
                const ny = dy / dist;
                const overlap = minDist - dist;
                const totalMass = a.mass + b.mass;

                a.x -= nx * overlap * (b.mass / totalMass);
                a.y -= ny * overlap * (b.mass / totalMass);
                b.x += nx * overlap * (a.mass / totalMass);
                b.y += ny * overlap * (a.mass / totalMass);

                const avx = a.body.velocity.x;
                const avy = a.body.velocity.y;
                const bvx = b.body.velocity.x;
                const bvy = b.body.velocity.y;
                const relativeAlongNormal = (bvx - avx) * nx + (bvy - avy) * ny;

                if (relativeAlongNormal < 0) {
                    const impulse = (2 * relativeAlongNormal) / totalMass;
                    a.body.velocity.x += impulse * b.mass * nx;
                    a.body.velocity.y += impulse * b.mass * ny;
                    b.body.velocity.x -= impulse * a.mass * nx;
                    b.body.velocity.y -= impulse * a.mass * ny;
                }
            }
        }
    }

    handleShipRockCollisions() {
        for (const asteroid of this.asteroids) {
            if (asteroid.isDead) continue;

            this.handleSingleShipRockCollision(this.player, 12, asteroid, true);
            if (asteroid.isDead) continue;

            for (const enemy of this.enemies) {
                if (enemy.isDead) continue;
                this.handleSingleShipRockCollision(enemy, enemy.radius ?? 14, asteroid, false);
                if (asteroid.isDead) break;
            }
        }
    }

    handleSingleShipRockCollision(ship, shipRadius, asteroid, isPlayer) {
        let dx = wrappedDelta(asteroid.x, ship.x, this.worldSize);
        let dy = wrappedDelta(asteroid.y, ship.y, this.worldSize);
        let dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = shipRadius + asteroid.radius;
        if (dist >= minDist) return false;

        if (asteroid.isMeteoroid) {
            this.destroyMeteoroid(asteroid);
            if (isPlayer) {
                this.damagePlayer({
                    shieldDamage: this.meteoroidDamagePerHit,
                    shieldInvuln: 0.22,
                    hullInvuln: 0.45,
                    shieldShake: 0.0025,
                    hullShake: 0.004
                });
            }
            return true;
        }

        if (dist <= 0.001) {
            const angle = Math.random() * Math.PI * 2;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;

        ship.x += nx * (overlap + 1);
        ship.y += ny * (overlap + 1);

        const relVX = ship.body.velocity.x - asteroid.body.velocity.x;
        const relVY = ship.body.velocity.y - asteroid.body.velocity.y;
        const relativeAlongNormal = relVX * nx + relVY * ny;
        const impactSpeed = Math.abs(relativeAlongNormal);

        if (relativeAlongNormal < 0) {
            const restitution = isPlayer ? 0.82 : 0.72;
            ship.body.velocity.x -= (1 + restitution) * relativeAlongNormal * nx;
            ship.body.velocity.y -= (1 + restitution) * relativeAlongNormal * ny;

            const tangentKick = Math.min(45, impactSpeed * 0.12);
            ship.body.velocity.x += -ny * tangentKick;
            ship.body.velocity.y += nx * tangentKick;
        }

        const now = this.time.now;
        if (!ship.nextRockBumpAt || now >= ship.nextRockBumpAt) {
            this.createAsteroidBump(ship.x - nx * shipRadius, ship.y - ny * shipRadius, nx, ny);
            if (isPlayer) this.audioSystem.playAsteroidBump?.();
            ship.nextRockBumpAt = now + 180;
        }

        if (isPlayer) {
            const scaledDamage = Phaser.Math.Clamp(
                this.asteroidDamageMin + Math.max(0, impactSpeed - 50) * 0.18,
                this.asteroidDamageMin,
                this.asteroidDamageMax
            );
            this.damagePlayer({
                shieldDamage: scaledDamage,
                shieldInvuln: 0.45,
                hullInvuln: 0.85,
                shieldShake: 0.0045,
                hullShake: 0.0065
            });
        }

        return true;
    }

    handleShipShipCollisions() {
        for (let i = 0; i < this.enemies.length; i++) {
            const a = this.enemies[i];
            if (a.isDead) continue;

            for (let j = i + 1; j < this.enemies.length; j++) {
                const b = this.enemies[j];
                if (b.isDead) continue;
                this.separateShips(a, a.radius ?? 14, b, b.radius ?? 14);
            }
        }
    }

    separateShips(a, aRadius, b, bRadius) {
        let dx = wrappedDelta(a.x, b.x, this.worldSize);
        let dy = wrappedDelta(a.y, b.y, this.worldSize);
        let dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = aRadius + bRadius + 6;
        if (dist >= minDist) return;

        if (dist <= 0.001) {
            const angle = Math.random() * Math.PI * 2;
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const push = (minDist - dist) * 0.5;

        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;

        const relVX = b.body.velocity.x - a.body.velocity.x;
        const relVY = b.body.velocity.y - a.body.velocity.y;
        const relativeAlongNormal = relVX * nx + relVY * ny;
        if (relativeAlongNormal < 0) {
            const impulse = relativeAlongNormal * 0.55;
            a.body.velocity.x += impulse * nx;
            a.body.velocity.y += impulse * ny;
            b.body.velocity.x -= impulse * nx;
            b.body.velocity.y -= impulse * ny;
        }
    }

    handlePlayerEnemyCollisions() {
        for (const enemy of this.enemies) {
            if (enemy.isDead) continue;
            const collisionDistance = wrappedDist(this.player.x, this.player.y, enemy.x, enemy.y, this.worldSize);
            if (collisionDistance >= enemy.radius + 12) continue;

            const shieldDamage = enemy.collisionDamage ?? this.shieldDamagePerHit;
            this.destroyEnemyByCollision(enemy);
            this.damagePlayer({
                shieldDamage,
                shieldInvuln: enemy.isKamikaze ? 0.6 : 0.45,
                hullInvuln: enemy.isKamikaze ? 1.15 : 0.95,
                shieldShake: enemy.isKamikaze ? 0.0065 : 0.005,
                hullShake: enemy.isKamikaze ? 0.009 : 0.007
            });
        }
    }

    destroyMeteoroid(asteroid) {
        if (!asteroid || asteroid.isDead) return;
        const x = asteroid.x;
        const y = asteroid.y;
        asteroid.die();
        this.createMeteoroidPop(x, y);
        this.audioSystem.playMeteoroidPop?.();
    }

    destroyEnemyByCollision(enemy) {
        if (!enemy || enemy.isDead) return;
        const x = enemy.x;
        const y = enemy.y;
        const explosionScale = enemy.explosionScale ?? 1;
        enemy.die();
        this.createEnemyCollisionExplosion(x, y, explosionScale);
        this.awardKill(x, y, false, enemy, { collision: true, skipBurst: true });
    }

    createEffectTween(depth, duration, draw, ease = 'Cubic.easeOut') {
        const gfx = this.add.graphics().setDepth(depth);
        this.tweens.addCounter({
            from: 0,
            to: 1,
            duration,
            ease,
            onUpdate: tween => {
                const t = tween.getValue();
                gfx.clear();
                draw(gfx, t);
            },
            onComplete: () => gfx.destroy()
        });
    }

    createMeteoroidPop(x, y) {
        this.createEffectTween(5, 180, (gfx, t) => {
            gfx.lineStyle(1.5, 0x9aa3aa, (1 - t) * 0.78);
            gfx.strokeCircle(x, y, 5 + 18 * t);
            gfx.fillStyle(0x9aa3aa, (1 - t) * 0.16);
            gfx.fillCircle(x, y, 12 * t);
        });
    }

    createAsteroidBump(x, y, nx, ny) {
        this.createEffectTween(5, 160, (gfx, t) => {
            gfx.lineStyle(1.2, 0x9aa3aa, (1 - t) * 0.58);
            gfx.lineBetween(x, y, x + nx * (8 + 18 * t), y + ny * (8 + 18 * t));
            gfx.strokeCircle(x, y, 4 + 10 * t);
        });
    }

    createEnemyCollisionExplosion(x, y, scale = 1) {
        this.createEffectTween(7, 260 + 110 * scale, (gfx, t) => {
            gfx.lineStyle(2.2, 0x4dff88, (1 - t) * 0.82);
            gfx.strokeCircle(x, y, (16 + 44 * t) * scale);
            gfx.lineStyle(1.4, 0xff6655, (1 - t) * 0.56);
            gfx.strokeCircle(x, y, (8 + 30 * t) * scale);
            if (scale > 1.35) {
                gfx.lineStyle(1, 0xffdd88, (1 - t) * 0.5);
                gfx.strokeCircle(x, y, (5 + 68 * t) * scale);
            }
        });
    }

    createEnemyMuzzleFlash(x, y, angle) {
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        this.createEffectTween(7, 120, (gfx, t) => {
            gfx.lineStyle(1.5, 0xff6655, (1 - t) * 0.75);
            gfx.lineBetween(x, y, x + nx * (18 + 22 * t), y + ny * (18 + 22 * t));
            gfx.fillStyle(0xff9944, (1 - t) * 0.24);
            gfx.fillCircle(x + nx * 10, y + ny * 10, 8 + 8 * t);
        });
    }

    awardKill(x, y, wasBlind, enemy = null, options = {}) {
        const baseValue = enemy?.scoreValue ?? 10;
        const blindBonus = wasBlind ? 2 : 1;
        const points = baseValue * this.multiplier * blindBonus;
        this.score += points;
        this.hitStreak += 1;
        this.multiplier = Math.min(8, 1 + Math.floor(this.hitStreak / 3));

        if (!options.skipBurst) this.createKillBurst(x, y);
        this.createFloatingScore(x, y, points, {
            blind: wasBlind,
            collision: options.collision,
            multiplier: this.multiplier
        });
        this.revealEnemiesAt(x, y, 220, 0.9);
        this.audioSystem.playKill();
        this.comms.push(options.collision && enemy?.isKamikaze ? 'ram' : 'enemyKill', {
            enemyType: enemy?.constructor?.type,
            collision: options.collision
        }, options.collision && enemy?.isKamikaze ? 4 : 3);
    }

    createFloatingScore(x, y, points, options = {}) {
        const color = options.collision ? '#ffddaa' : '#7fffdf';
        const mult = options.multiplier ?? 1;
        const label = mult > 1 ? `+${points} ×${mult}` : `+${points}`;
        const text = this.add.text(x, y - 22, label, {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: options.collision ? '20px' : '18px',
            color,
            stroke: '#020610',
            strokeThickness: 4
        }).setOrigin(0.5).setDepth(12).setAlpha(0.95);

        const driftX = Phaser.Math.Between(-12, 12);
        this.tweens.add({
            targets: text,
            x: x + driftX,
            y: y - 70,
            alpha: 0,
            scale: 1.18,
            duration: 820,
            ease: 'Cubic.easeOut',
            onComplete: () => text.destroy()
        });
    }

    revealEnemiesAt(x, y, radius, brightness = 1) {
        for (const enemy of this.enemies) {
            if (enemy.isDead) continue;
            const d = wrappedDist(x, y, enemy.x, enemy.y, this.worldSize);
            if (d <= radius) enemy.reveal(brightness);
        }
    }

    createKillBurst(x, y) {
        const gfx = this.add.graphics().setDepth(4);
        const maxRadius = 220;

        this.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 420,
            ease: 'Cubic.easeOut',
            onUpdate: tween => {
                const t = tween.getValue();
                gfx.clear();
                gfx.lineStyle(3, 0x4dff88, (1 - t) * 0.75);
                gfx.strokeCircle(x, y, maxRadius * t);
                gfx.fillStyle(0x4dff88, (1 - t) * 0.12);
                gfx.fillCircle(x, y, maxRadius * 0.35 * t);
            },
            onComplete: () => gfx.destroy()
        });
    }

    updateSpawning(dt) {
        const alive = this.enemies.filter(enemy => !enemy.isDead).length;
        const maxAlive = Math.min(44, 16 + Math.floor(this.survivalTime / 18) * 2);
        if (alive >= maxAlive) return;

        this.spawnTimer -= dt;
        if (this.spawnTimer > 0) return;

        const waveSize = this.survivalTime > 85 ? 2 : 1;
        for (let i = 0; i < waveSize && alive + i < maxAlive; i++) {
            this.spawnEnemyAwayFromPlayer(this.chooseEnemyType(), 760);
        }

        // Interval ramps from 5.2s at t=0 down to 1.4s floor at ~110s.
        this.spawnTimer = Math.max(1.4, 5.2 - this.survivalTime * 0.035);
    }

    damagePlayer(options = {}) {
        if (this.invulnTimer > 0 || this.gameOver) return;

        const {
            shieldDamage = this.shieldDamagePerHit,
            shieldInvuln = 0.35,
            hullInvuln = 1.0,
            shieldShake = 0.004,
            hullShake = 0.006
        } = options;

        this.hitStreak = 0;
        this.multiplier = 1;

        let hullDamage = 0;
        const shieldFraction = this.energy.shieldFraction;
        if (shieldFraction > 0 && shieldFraction <= this.lowShieldLeakThreshold) {
            hullDamage += 0.5 - shieldFraction;
        }

        const remainingDamage = this.energy.absorbShieldDamage(shieldDamage);
        hullDamage += remainingDamage > 0 ? 1 : 0;

        if (remainingDamage <= 0) {
            this.applyHullDamage(hullDamage);
            this.invulnTimer = hullDamage > 0 ? Math.max(0.65, shieldInvuln) : shieldInvuln;
            this.shieldHitFlash = 0.34;
            this.createPlayerImpactRing(0x66aaff, 42, 0.42);
            this.audioSystem.playShieldHit();
            this.cameras.main.shake(100, shieldShake);
            if (this.hull <= 0) {
                this.destroyPlayerShip();
            }
            return;
        }

        this.invulnTimer = hullInvuln;
        this.applyHullDamage(hullDamage);
        this.hullHitFlash = 0.46;
        this.createPlayerImpactRing(0xff6655, 62, 0.52);
        this.audioSystem.playHullHit();
        this.cameras.main.shake(140, hullShake);

        if (this.hull <= 0) {
            this.destroyPlayerShip();
        }
    }

    applyHullDamage(amount) {
        if (amount <= 0 || this.gameOver) return;
        this.hullHitFlash = Math.max(this.hullHitFlash, 0.32);
        this.hullDamage = Math.min(this.maxHull, this.hullDamage + amount);
        this.hull = Math.max(0, this.maxHull - this.hullDamage);
    }

    createPlayerImpactRing(color, maxRadius, alphaScale) {
        const x = this.player.x;
        const y = this.player.y;
        const gfx = this.add.graphics().setDepth(11);

        this.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 260,
            ease: 'Cubic.easeOut',
            onUpdate: tween => {
                const t = tween.getValue();
                gfx.clear();
                gfx.lineStyle(2, color, (1 - t) * alphaScale);
                gfx.strokeCircle(x, y, 18 + maxRadius * t);
            },
            onComplete: () => gfx.destroy()
        });
    }

    destroyPlayerShip() {
        if (this.gameOver) return;

        this.hull = 0;
        this.hullDamage = this.maxHull;
        this.gameOver = true;
        this.player.body.setAcceleration(0, 0);
        this.player.body.setVelocity(0, 0);
        this.player.setVisible(false);
        this.createPlayerExplosion(this.player.x, this.player.y, this.player.rotation);
        this.audioSystem.playDeath();
        this.audioSystem.stopContinuousAudio();
        this.cameras.main.shake(320, 0.014);

        if (!this.highScoreSubmitted) {
            this.highScoreSubmitted = true;
            this.highScoreResult = submitHighScore({
                score:        this.score,
                survivalTime: this.survivalTime,
                multiplier:   this.multiplier,
                date:         new Date().toISOString()
            });
        }
    }

    createPlayerExplosion(x, y, rotation) {
        const burst = this.add.graphics().setDepth(12);
        this.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 520,
            ease: 'Cubic.easeOut',
            onUpdate: tween => {
                const t = tween.getValue();
                burst.clear();
                burst.lineStyle(3, 0xffddaa, (1 - t) * 0.85);
                burst.strokeCircle(x, y, 90 * t);
                burst.lineStyle(1, 0xff6655, (1 - t) * 0.55);
                burst.strokeCircle(x, y, 145 * t);
            },
            onComplete: () => burst.destroy()
        });

        const fragments = [
            [{ x: 12, y: 0 }, { x: -4, y: 4 }, { x: -2, y: -4 }],
            [{ x: -9, y: 7 }, { x: -5, y: 0 }, { x: -14, y: 2 }],
            [{ x: -5, y: 0 }, { x: -9, y: -7 }, { x: -14, y: -2 }],
            [{ x: 3, y: 0 }, { x: 7, y: 2 }, { x: 7, y: -2 }]
        ];

        for (const points of fragments) {
            const frag = this.add.graphics().setDepth(13);
            frag.lineStyle(1.5, 0xffddaa, 0.95);
            frag.beginPath();
            frag.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) frag.lineTo(points[i].x, points[i].y);
            frag.closePath();
            frag.strokePath();
            frag.setPosition(x, y);
            frag.setRotation(rotation);

            const angle = rotation + Phaser.Math.FloatBetween(-Math.PI, Math.PI);
            const distance = Phaser.Math.Between(80, 190);
            this.tweens.add({
                targets: frag,
                x: x + Math.cos(angle) * distance,
                y: y + Math.sin(angle) * distance,
                rotation: rotation + Phaser.Math.FloatBetween(-3.8, 3.8),
                alpha: 0,
                duration: Phaser.Math.Between(900, 1300),
                ease: 'Cubic.easeOut',
                onComplete: () => frag.destroy()
            });
        }
    }

    createStarField() {
        const W = this.scale.width;
        const H = this.scale.height;
        const T = 1024; // tile texture size

        const layerDefs = [
            { key: 'stars0', n: 120, color: 0x4a5a72, aMin: 0.15, aMax: 0.45, rMin: 0.3, rMax: 0.8  },
            { key: 'stars1', n: 50,  color: 0x8fa8c0, aMin: 0.35, aMax: 0.75, rMin: 0.6, rMax: 1.4  },
            { key: 'stars2', n: 15,  color: 0xd0e4f0, aMin: 0.60, aMax: 0.90, rMin: 1.0, rMax: 2.2  },
        ];

        for (const d of layerDefs) {
            const g = this.add.graphics();
            for (let i = 0; i < d.n; i++) {
                g.fillStyle(d.color, Phaser.Math.FloatBetween(d.aMin, d.aMax));
                g.fillCircle(
                    Phaser.Math.Between(0, T),
                    Phaser.Math.Between(0, T),
                    Phaser.Math.FloatBetween(d.rMin, d.rMax)
                );
            }
            g.generateTexture(d.key, T, T);
            g.destroy();
        }

        // TileSprites are fixed to screen (scrollFactor 0); tilePosition updated each frame.
        this.starLayer0 = this.add.tileSprite(0, 0, W, H, 'stars0').setOrigin(0, 0).setScrollFactor(0).setDepth(-100);
        this.starLayer1 = this.add.tileSprite(0, 0, W, H, 'stars1').setOrigin(0, 0).setScrollFactor(0).setDepth(-99);
        this.starLayer2 = this.add.tileSprite(0, 0, W, H, 'stars2').setOrigin(0, 0).setScrollFactor(0).setDepth(-98);
        this.starScrollX = 0;
        this.starScrollY = 0;
    }

    updateStarParallax(dx, dy) {
        this.starScrollX += dx;
        this.starScrollY += dy;
        this.starLayer0.setTilePosition(this.starScrollX * 0.025, this.starScrollY * 0.025);
        this.starLayer1.setTilePosition(this.starScrollX * 0.07, this.starScrollY * 0.07);
        this.starLayer2.setTilePosition(this.starScrollX * 0.12, this.starScrollY * 0.12);
    }

    centerCameraOnPlayer() {
        this.cameras.main.scrollX = this.player.x - this.scale.width * 0.5;
        this.cameras.main.scrollY = this.player.y - this.scale.height * 0.5;
    }
}
