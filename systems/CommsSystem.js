import { wrappedDist } from '../utils/mathUtils.js';

const PREFIXES = ['RX', 'FRAG', 'CARRIER', 'BURST'];

const POOLS = {
    enemyKill: [
        'contact lost.',
        'oh sh%&',
        'EJECT EJECT EJECT',
        'HULL BREACH IMMINENT',
        "I'LL GET YOU NEXT TIME",
        'I am a leaf on the wind'    
    ],
    attack: [
        'pursuit course!',
        'decloak window green',
        'target tone acquired',
        'firing on pulse origin',
        'weapons locked',
        'make them ping again',
        "I'VE GOT YOU NOW!",
        'fox two, or is this fox one',
        'firing main battery',
        'launching torpedo',
        'missile away',
        'hello there!',
        'greetings, human!',
        'you have entered the danger zone'
    ],
    ram: [
        'collision course accepted',
        'range: closing',
        'burn straight through',
        'no braking solution',
        'impact vector confirmed',
        'RAMMING SPEED!',
        'hold on to something',
        'there is no defense to the Picard maneuver!',
        'embracing the void',
        'if we are going down, we are taking them with us'
    ],
    multiContact: [
        'unregistered pulse detected',
        'carrier wave only',
        'multiple returns / no registry',
        'relay handshake failed',
        'signal source unknown',
        'multiple contacts detected',
        'are you receiving this?',
        'the swarm is real',
        'they are coming'
    ],
    critical: [
        'enemy has taken heavy damage',
        'finish them!',
        'surrender or die!',
        'prepare for boarding',
        'critical systems failing',
        'distress signal received',
        'SOS SOS SOS'
    ],
    idle: [
        'beacon 12 repeating',
        'mining lane closed',
        'navigation buoy drifting',
        'survey packet corrupt',
        'long-range telemetry fragment corrupted',
        'unidentified signal detected',
        'I have a bad feeling about this',
        'message incomplete, please retransmit',
        'signal strength fading',
        'is this thing on?',
        'radio check, do you copy?'
    ],
    rare: [
        'bonus ship not found',
        'hyperspace channel deprecated',
        'wraparound confirmed',
        'something answered before we pinged',
        'may the farce be with you',
        'breaker one-seven'

    ]
};

function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export class CommsSystem {
    constructor(scene) {
        this.scene = scene;
        this.current = null;
        this.cooldown = this.nextSignalCooldown(1);
        this.idleTimer = this.nextIdleDelay();
        this.criticalCooldown = 0;
    }

    update(dt, game) {
        this.cooldown = Math.max(0, this.cooldown - dt);
        this.criticalCooldown = Math.max(0, this.criticalCooldown - dt);

        if (this.current) {
            this.current.age += dt;
            if (this.current.age >= this.current.lifetime) this.current = null;
        }

        if (!game.gameOver && game.hull <= 1.25 && this.criticalCooldown <= 0) {
            this.push('critical', {}, 2);
            this.criticalCooldown = 12 + Math.random() * 6;
            return;
        }

        this.idleTimer -= dt;
        if (!game.gameOver && this.idleTimer <= 0) {
            this.push(Math.random() < 0.12 ? 'rare' : 'idle', {}, 1);
            this.idleTimer = this.nextIdleDelay();
        }
    }

    push(type, context = {}, priority = 1) {
        if (this.cooldown > 0 && (!this.current || priority <= this.current.priority)) return false;
        if (this.current && priority < this.current.priority) return false;

        const source = POOLS[type] ?? POOLS.idle;
        const rawText = pick(source);
        const frequency = Math.round(Phaser.Math.Between(500, 2000));
        const prefix = type === 'ram' ? 'BURST' : pick(PREFIXES);
        const lifetime = 4.3 + priority * 0.35;
        const duration = 0.7 + Math.random() * 0.7;

        // Pick a random alive enemy as the comms source; derive amplitude from distance.
        const aliveEnemies = (this.scene.enemies ?? []).filter(e => !e.isDead);
        let sourceX = null, sourceY = null, amplitude;
        if (aliveEnemies.length > 0) {
            const src = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
            sourceX = src.x;
            sourceY = src.y;
            const player = this.scene.player;
            const worldSize = this.scene.worldSize ?? 4000;
            const dist = player ? wrappedDist(player.x, player.y, sourceX, sourceY, worldSize) : 800;
            amplitude = clamp(1.1 - dist / 2200, 0.18, 1);
        } else {
            amplitude = this.pickAmplitude(priority);
        }

        const isBroken = amplitude < 0.38;
        const text = this.corrupt(rawText, amplitude);
        const header = `${prefix} ${frequency} MHz`;

        this.current = {
            type,
            header,
            text,
            rawText,
            frequency,
            amplitude,
            isBroken,
            age: 0,
            lifetime,
            signalLifetime: duration + 0.6,
            priority,
            color: isBroken ? 0xff9966 : 0xff3344
        };

        if (sourceX !== null) {
            this.scene.addCommsBlip?.(sourceX, sourceY, clamp(amplitude * 1.1, 0.35, 1));
        }

        this.cooldown = this.nextSignalCooldown(priority);
        this.scene.audioSystem?.playCommsSignal?.({ frequency, amplitude, duration });
        return true;
    }

    getCurrentMessage() {
        return this.current;
    }

    nextIdleDelay() {
        return 1 + Math.random() * 19;
    }

    nextSignalCooldown(priority = 1) {
        const urgency = Math.max(0, Math.min(1, (priority - 1) / 3));
        const min = 1.0 + (0.6 - 1.0) * urgency;
        const max = 20.0 + (8.0 - 20.0) * urgency;
        return Phaser.Math.FloatBetween(min, max);
    }

    pickAmplitude(priority) {
        const base = Phaser.Math.FloatBetween(0.22, 0.9);
        return clamp(base + priority * 0.06, 0.18, 1);
    }

    corrupt(text, amplitude) {
        const GARBAGE = '#@*%$!?~&';
        const junk = (len) => Array.from({ length: len }, () => GARBAGE[Math.floor(Math.random() * GARBAGE.length)]).join('');

        if (amplitude >= 0.65) {
            if (Math.random() < 0.10) return text.replace(/\w+$/, junk(3));
            return text;
        }

        const words = text.split(' ');
        if (amplitude >= 0.38) {
            if (words.length > 3) words.splice(Phaser.Math.Between(1, words.length - 2), 1, junk(4));
            return words.join(' ');
        }

        const first = words.slice(0, Math.max(1, Math.ceil(words.length * 0.45))).join(' ');
        return `${junk(3)} ${first} ${junk(4)}`;
    }
}
