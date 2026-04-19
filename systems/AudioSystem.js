// AudioSystem
// Lightweight Web Audio synthesis for the scanner loop. No external assets.

import { wrappedDelta, wrappedDist } from '../utils/mathUtils.js';

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function effectsGainToAmplitude(value) {
    return clamp(value, 0, 2) * 8.0;
}

export class AudioSystem {
    constructor(scene) {
        this.scene = scene;
        this.ctx = null;
        this.master = null;
        this.fxBus = null;
        this.fxFadeGain = null;
        this.fxReverbInput = null;
        this.emBus = null;
        this.echoBus = null;
        this.echoAnalyser = null;
        this.echoSpectrumData = null;
        this.analyser = null;
        this.spectrumData = null;
        this.chargeOsc = null;
        this.chargeGain = null;
        this.engineOsc = null;
        this.engineGain = null;
        this.engineNoise = null;
        this.engineNoiseGain = null;
        this.engineNoiseFilter = null;
        this.ambientVoices = [];
        this.enemyVoices = [];
        this.voiceContactTimer = 0;
        this.lowShieldTimer = 0;
        this.stoppedForGameOver = false;
        this.gameOverAmbient = false;
        this.effectsGain = 1;
        this.enabled = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);

        if (!this.enabled) return;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.95;
        this.master.connect(this.ctx.destination);

        this.effectsGain = 1;

        this.fxBus = this.ctx.createGain();
        this.fxBus.gain.value = effectsGainToAmplitude(this.effectsGain);

        this.fxFadeGain = this.ctx.createGain();
        this.fxFadeGain.gain.value = 1;
        this.fxBus.connect(this.fxFadeGain);
        this.fxFadeGain.connect(this.master);

        this.emBus = this.ctx.createGain();
        this.emBus.gain.value = 1;

        // Master analyser - captures weapons, engine, pulses.
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.35;
        this.analyser.minDecibels = -65;
        this.analyser.maxDecibels = -10;
        this.spectrumData = new Uint8Array(this.analyser.frequencyBinCount);

        // EM-only analyser - captures only the enemy voice bus.
        this.emAnalyser = this.ctx.createAnalyser();
        this.emAnalyser.fftSize = 2048;
        this.emAnalyser.smoothingTimeConstant = 0.72;
        this.emAnalyser.minDecibels = -55;
        this.emAnalyser.maxDecibels = -15;
        this.emSpectrumData = new Uint8Array(this.emAnalyser.frequencyBinCount);

        // Echo-only analyser - captures pulse return pings so UIScene can draw them
        // in a fourth amber layer. Fast smoothing (0.20) so brief transients register clearly.
        this.echoBus = this.ctx.createGain();
        this.echoBus.gain.value = 1;
        this.echoAnalyser = this.ctx.createAnalyser();
        this.echoAnalyser.fftSize = 2048;
        this.echoAnalyser.smoothingTimeConstant = 0.20;
        this.echoAnalyser.minDecibels = -58;
        this.echoAnalyser.maxDecibels = -10;
        this.echoSpectrumData = new Uint8Array(this.echoAnalyser.frequencyBinCount);

        this.emBus.connect(this.fxBus);
        this.emBus.connect(this.emAnalyser);
        this.echoBus.connect(this.fxBus);
        this.echoBus.connect(this.echoAnalyser);
        this.master.connect(this.analyser);

        this.createChargeTone();
        this.createEngineTone();
        this.createEnemyVoices(4);
        this.createAmbient();

        scene.input.keyboard.on('keydown', () => this.resume());
        scene.input.on('pointerdown', () => this.resume());
    }

    resume() {
        if (!this.enabled || !this.ctx || this.ctx.state !== 'suspended') return;
        this.ctx.resume();
    }

    createChargeTone() {
        this.chargeOsc = this.ctx.createOscillator();
        this.chargeGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        this.chargeOsc.type = 'sawtooth';
        this.chargeOsc.frequency.value = 120;
        this.chargeGain.gain.value = 0;
        filter.type = 'lowpass';
        filter.frequency.value = 900;

        this.chargeOsc.connect(filter);
        filter.connect(this.chargeGain);
        this.chargeGain.connect(this.fxBus);
        this.chargeOsc.start();
    }

    createEngineTone() {
        this.engineOsc = this.ctx.createOscillator();
        this.engineGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        this.engineOsc.type = 'sawtooth';
        this.engineOsc.frequency.value = 54;
        this.engineGain.gain.value = 0.012;
        filter.type = 'lowpass';
        filter.frequency.value = 120;

        this.engineOsc.connect(filter);
        filter.connect(this.engineGain);
        this.engineGain.connect(this.fxBus);
        this.engineOsc.start();

        const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

        this.engineNoise = this.ctx.createBufferSource();
        this.engineNoiseGain = this.ctx.createGain();
        this.engineNoiseFilter = this.ctx.createBiquadFilter();
        this.engineNoise.buffer = buffer;
        this.engineNoise.loop = true;
        this.engineNoiseGain.gain.value = 0;
        this.engineNoiseFilter.type = 'lowpass';
        this.engineNoiseFilter.frequency.value = 150;
        this.engineNoiseFilter.Q.value = 0.35;
        this.engineNoise.connect(this.engineNoiseFilter);
        this.engineNoiseFilter.connect(this.engineNoiseGain);
        this.engineNoiseGain.connect(this.fxBus);
        this.engineNoise.start();
    }

    createEnemyVoices(count) {
        for (let i = 0; i < count; i++) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const pan = this.ctx.createStereoPanner();
            const filter = this.ctx.createBiquadFilter();

            osc.type = i % 2 === 0 ? 'triangle' : 'square';
            osc.frequency.value = 80 + i * 27;
            filter.type = 'bandpass';
            filter.frequency.value = 180 + i * 70;
            filter.Q.value = 5;
            gain.gain.value = 0;

            osc.connect(filter);
            filter.connect(pan);
            pan.connect(gain);
            gain.connect(this.emBus);
            osc.start();

            this.enemyVoices.push({ osc, gain, pan, filter });
        }
    }

    // feed: { gameOver, capFraction, spaceKeyIsDown, playerThrust, playerX, playerY, playerVX, playerVY, worldSize, enemies, shieldFraction, underAttack, critical }
    update(delta, feed) {
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime;
        if (feed.gameOver) {
            if (!this.stoppedForGameOver) this.stopContinuousAudio();
            this.updateAmbient(delta / 1000);
            this.updateAdaptiveLayers(now, false, false);
            return;
        }

        this.stoppedForGameOver = false;
        this.gameOverAmbient = false;
        if (this.ctx.state === 'suspended') this.ctx.resume();

        this.fxFadeGain.gain.cancelScheduledValues(now);
        this.fxFadeGain.gain.setTargetAtTime(1, now, 0.12);

        const charge = feed.capFraction;
        const chargeTarget = feed.spaceKeyIsDown && charge > 0.01 ? 0.008 + charge * 0.018 : 0;
        this.chargeGain.gain.setTargetAtTime(chargeTarget, now, 0.11);
        this.chargeOsc.frequency.setTargetAtTime(82 + charge * 260, now, 0.09);

        const thrust  = Math.abs(feed.playerThrust);
        const forward = feed.playerThrust > 0 ? 1 : 0;
        this.engineGain.gain.setTargetAtTime(thrust * (forward ? 0.093 : 0.053), now, 0.07);
        this.engineNoiseGain.gain.setTargetAtTime(thrust * (forward ? 0.06 : 0.026), now, 0.055);
        this.engineNoiseFilter.frequency.setTargetAtTime(120 + thrust * (forward ? 360 : 150), now, 0.07);
        this.engineOsc.frequency.setTargetAtTime(34 + thrust * (forward ? 24 : 12), now, 0.08);

        this.updateEnemyVoices(feed, now);
        this.updateLowShieldWarning(delta, feed.gameOver, feed.shieldFraction);
        this.updateAmbient(delta / 1000);
        this.updateAdaptiveLayers(now, feed.underAttack ?? false, feed.critical ?? false);
    }

    updateAdaptiveLayers(now, underAttack, critical) {
        if (!this.attackDrumGain || !this.heartbeatGain) return;

        // Combat pressure: a short rush of low drums, then a long gap.
        const BURST_GAP = 3.35;
        const LOOKAHEAD = 0.15;
        const BURST = [
            { offset: 0.00, level: 0.92 },
            { offset: 0.11, level: 0.62 },
            { offset: 0.22, level: 0.78 },
            { offset: 0.36, level: 0.54 },
            { offset: 0.54, level: 1.00 },
        ];

        if (underAttack) {
            if (this.attackBeatTime === null) {
                this.attackBeatTime  = now;
            }
            while (this.attackBeatTime < now + LOOKAHEAD) {
                const burstStart = Math.max(this.attackBeatTime, now);
                for (const hit of BURST) {
                    this.scheduleKick(burstStart + hit.offset, hit.level);
                }
                this.attackBeatTime += BURST_GAP;
            }
            this.attackDrumGain.gain.setTargetAtTime(0.88, now, 0.2);
        } else {
            this.attackBeatTime  = null;
            this.attackDrumGain.gain.setTargetAtTime(0, now, 1.5);
        }

        this.heartbeatGain.gain.setTargetAtTime(critical ? 0.35 : 0, now, critical ? 0.25 : 1.5);
    }

    setEffectsGain(value) {
        this.effectsGain = clamp(value, 0, 2);
        if (this.enabled && this.ctx && this.fxBus) {
            this.fxBus.gain.cancelScheduledValues(this.ctx.currentTime);
            this.fxBus.gain.setTargetAtTime(effectsGainToAmplitude(this.effectsGain), this.ctx.currentTime, 0.03);
        }
    }

    getEffectsGain() {
        return this.effectsGain;
    }

    stopContinuousAudio() {
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime;
        this.stoppedForGameOver = true;
        this.fxFadeGain.gain.cancelScheduledValues(now);
        this.fxFadeGain.gain.setValueAtTime(this.fxFadeGain.gain.value, now);
        this.fxFadeGain.gain.exponentialRampToValueAtTime(0.0001, now + 3.0);
        this.chargeGain.gain.setTargetAtTime(0, now, 0.8);
        this.engineGain.gain.setTargetAtTime(0, now, 1.2);
        this.engineNoiseGain.gain.setTargetAtTime(0, now, 1.2);
        for (const voice of this.enemyVoices) {
            voice.gain.gain.setTargetAtTime(0, now, 1.2);
        }
        this.transitionAmbientForGameOver(now);
    }

    getSpectrumData() {
        if (!this.enabled || !this.analyser || !this.spectrumData) return null;
        this.analyser.getByteFrequencyData(this.spectrumData);
        return this.spectrumData;
    }

    getEmSpectrumData() {
        if (!this.enabled || !this.emAnalyser || !this.emSpectrumData) return null;
        this.emAnalyser.getByteFrequencyData(this.emSpectrumData);
        return this.emSpectrumData;
    }

    getEchoSpectrumData() {
        if (!this.enabled || !this.echoAnalyser || !this.echoSpectrumData) return null;
        this.echoAnalyser.getByteFrequencyData(this.echoSpectrumData);
        return this.echoSpectrumData;
    }

    updateEnemyVoices(feed, now) {
        // Re-sort closest contacts every 80 ms rather than every frame.
        this.voiceContactTimer -= (now - (this._lastVoiceNow ?? now));
        this._lastVoiceNow = now;
        if (this.voiceContactTimer <= 0) {
            this._voiceContacts = feed.enemies
                .filter(enemy => !enemy.isDead)
                .map(enemy => ({
                    enemy,
                    distance: wrappedDist(feed.playerX, feed.playerY, enemy.x, enemy.y, feed.worldSize)
                }))
                .filter(contact => contact.distance < 1450)
                .sort((a, b) => a.distance - b.distance)
                .slice(0, this.enemyVoices.length);
            this.voiceContactTimer = 0.08;
        }
        const contacts = this._voiceContacts ?? [];

        for (let i = 0; i < this.enemyVoices.length; i++) {
            const voice = this.enemyVoices[i];
            const contact = contacts[i];

            if (!contact || contact.enemy.isDead || feed.gameOver) {
                voice.gain.gain.setTargetAtTime(0, now, 0.18);
                continue;
            }

            const enemy = contact.enemy;
            const dx = wrappedDelta(feed.playerX, enemy.x, feed.worldSize);
            const dy = wrappedDelta(feed.playerY, enemy.y, feed.worldSize);
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const nx = dx / dist;
            const ny = dy / dist;
            const pan = clamp(dx / 620, -1, 1);
            const proximity = 1 - contact.distance / 1450;
            const closeBoost = Math.pow(proximity, 1.7);
            const isBurst  = enemy.constructor.type === 'burst';
            const isSeeker = enemy.constructor.type === 'seeker';
            // Drifter: 108 Hz (low triangle hum), Seeker: 175 Hz (mid sawtooth), Burst: 260 Hz (high square).
            const baseFreq = isBurst ? 260 : isSeeker ? 175 : 108;
            const tremolo  = isBurst ? 0.45 + 0.55 * Math.sin(now * 22) : isSeeker ? 0.7 + 0.3 * Math.sin(now * 5) : 1;
            const enemyVX = enemy.body?.velocity?.x ?? 0;
            const enemyVY = enemy.body?.velocity?.y ?? 0;
            const radialVelocity = (enemyVX - (feed.playerVX ?? 0)) * nx + (enemyVY - (feed.playerVY ?? 0)) * ny;
            const dopplerFactor = clamp(1 - radialVelocity * 0.0012, 0.72, 1.38);
            const shiftedFreq = (baseFreq + proximity * 40 + i * 6) * dopplerFactor;

            voice.osc.type = isBurst ? 'square' : isSeeker ? 'sawtooth' : 'triangle';
            voice.osc.frequency.setTargetAtTime(shiftedFreq, now, 0.06);
            voice.filter.frequency.setTargetAtTime(shiftedFreq * 1.8, now, 0.08);
            voice.pan.pan.setTargetAtTime(pan, now, 0.08);
            voice.gain.gain.setTargetAtTime(0.01 + closeBoost * 0.18 * tremolo, now, 0.07);
        }
    }

    updateLowShieldWarning(delta, gameOver, shieldFraction) {
        this.lowShieldTimer = Math.max(0, this.lowShieldTimer - delta / 1000);
        if (gameOver || shieldFraction <= 0 || shieldFraction >= 0.22) return;
        if (this.lowShieldTimer > 0) return;

        this.lowShieldTimer = 1.2;
        this.playTone({
            frequency: 82,
            type: 'sine',
            duration: 0.16,
            gain: 0.08,
            color: 'lowpass',
            filterFrequency: 240
        });
    }

    // -------------------------------------------------------------------------
    // Ambient music - compact procedural drone + reverb
    // -------------------------------------------------------------------------

    createReverb(duration = 2.6, decay = 2.4) {
        const sampleRate = this.ctx.sampleRate;
        const length = Math.ceil(sampleRate * duration);
        const impulse = this.ctx.createBuffer(2, length, sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < length; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
            }
        }
        const conv = this.ctx.createConvolver();
        conv.buffer = impulse;
        return conv;
    }

    createAmbient() {
        this.sharedReverb  = this.createReverb();
        this.reverbInput   = this.ctx.createGain();
        this.reverbInput.gain.value = 1.0;
        const reverbReturn = this.ctx.createGain();
        reverbReturn.gain.value = 0.88;
        this.ambientOut = this.ctx.createGain();
        this.ambientOut.gain.value = 3.0;
        this.ambientOut.connect(this.ctx.destination);
        this.reverbInput.connect(this.sharedReverb);
        this.sharedReverb.connect(reverbReturn);
        reverbReturn.connect(this.ambientOut);

        this.ambientBus = this.ctx.createGain();
        this.ambientBus.gain.value = 0;
        this.ambientBus.connect(this.reverbInput);
        const ambientDry = this.ctx.createGain();
        ambientDry.gain.value = 0.08;
        this.ambientBus.connect(ambientDry);
        ambientDry.connect(this.ambientOut);

        this.fxReverbInput = this.ctx.createGain();
        this.fxReverbInput.gain.value = 1.0;
        const fxReverb = this.createReverb(2.0, 2.2);
        const fxReverbReturn = this.ctx.createGain();
        fxReverbReturn.gain.value = 0.62;
        this.fxReverbInput.connect(fxReverb);
        fxReverb.connect(fxReverbReturn);
        fxReverbReturn.connect(this.fxBus);

        this.ambientVoices = [
            { freq: 36.7, detune: 0.42, type: 'sine', gain: 0.28 },
            { freq: 55.0, detune: 0.75, type: 'triangle', gain: 0.18 },
            { freq: 110.2, detune: 1.1, type: 'sine', gain: 0.08 },
        ].map(v => {
            const osc = this.ctx.createOscillator();
            const beat = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = v.type;
            beat.type = v.type === 'sine' ? 'triangle' : 'sine';
            osc.frequency.value = v.freq;
            beat.frequency.value = v.freq + v.detune;
            gain.gain.value = v.gain;
            osc.connect(gain);
            beat.connect(gain);
            gain.connect(this.ambientBus);
            osc.start();
            beat.start();
            return { ...v, osc, beat, gain };
        });

        const noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        const noiseFilter = this.ctx.createBiquadFilter();
        const noiseGain = this.ctx.createGain();
        noise.buffer = noiseBuffer;
        noise.loop = true;
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.value = 360;
        noiseGain.gain.value = 0.014;
        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.ambientBus);
        noise.start();

        this.dronePitches = [
            [36.7, 55.0, 110.2],
            [43.7, 65.4, 131.2],
            [49.0, 73.4, 110.2],
            [41.2, 55.0, 123.5],
            [32.7, 49.0,  98.0],
        ];
        this.currentDroneIdx  = 0;
        this.droneChangeTimer = 12 + Math.random() * 10;
        this.ambientReady = false;

        this.createAdaptiveLayers();
    }

    createAdaptiveLayers() {
        // Master gain for the drum pattern - fades in/out with attack state.
        // Routes to ambientOut (bypasses analyser) - drums never appear on the spectrum display.
        this.attackDrumGain = this.ctx.createGain();
        this.attackDrumGain.gain.value = 0;
        this.attackDrumGain.connect(this.ambientOut);
        this.attackBeatTime = null;

        // Critical heartbeat - two detuned sine oscillators, fades in when hull/shield is critical.
        const heartA = this.ctx.createOscillator();
        const heartB = this.ctx.createOscillator();
        heartA.type = 'sine';
        heartA.frequency.value = 90;
        heartB.type = 'triangle';
        heartB.frequency.value = 140;
        this.heartbeatGain = this.ctx.createGain();
        this.heartbeatGain.gain.value = 0;
        heartA.connect(this.heartbeatGain);
        heartB.connect(this.heartbeatGain);
        this.heartbeatGain.connect(this.ambientOut);
        heartA.start();
        heartB.start();
        this.heartbeatOscA = heartA;
        this.heartbeatOscB = heartB;
    }

    // Synthesized low drum: soft attack, slow pitch fall, and resonant tail.
    scheduleKick(time, level = 1.0) {
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();
        const tail = this.ctx.createOscillator();
        const tailGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(92, time);
        osc.frequency.exponentialRampToValueAtTime(34, time + 0.22);
        oscGain.gain.setValueAtTime(0.001, time);
        oscGain.gain.linearRampToValueAtTime(0.42 * level, time + 0.025);
        oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.58);

        tail.type = 'triangle';
        tail.frequency.setValueAtTime(38, time);
        tail.frequency.exponentialRampToValueAtTime(29, time + 0.48);
        tailGain.gain.setValueAtTime(0.001, time);
        tailGain.gain.linearRampToValueAtTime(0.24 * level, time + 0.035);
        tailGain.gain.exponentialRampToValueAtTime(0.001, time + 0.82);

        filter.type = 'lowpass';
        filter.frequency.value = 145;
        filter.Q.value = 0.7;

        osc.connect(oscGain);
        tail.connect(tailGain);
        oscGain.connect(filter);
        tailGain.connect(filter);
        filter.connect(this.attackDrumGain);
        osc.start(time);
        tail.start(time);
        osc.stop(time + 0.62);
        tail.stop(time + 0.86);
        tail.onended = () => { osc.disconnect(); oscGain.disconnect(); tail.disconnect(); tailGain.disconnect(); filter.disconnect(); };
    }

    transitionAmbientForGameOver(now) {
        if (this.gameOverAmbient || !this.ambientOut) return;
        this.gameOverAmbient = true;

        this.ambientOut.gain.cancelScheduledValues(now);
        this.ambientOut.gain.setTargetAtTime(2.16, now, 2.8);
        this.ambientBus.gain.cancelScheduledValues(now);
        this.ambientBus.gain.setTargetAtTime(0.46, now, 3.2);

        [27.5, 41.2, 82.4].forEach((freq, i) => {
            const voice = this.ambientVoices[i];
            if (!voice) return;
            voice.gain.gain.setTargetAtTime(voice.gain.gain.value * 0.5, now, 2.6);
            voice.osc.frequency.linearRampToValueAtTime(freq, now + 4.8);
            voice.beat.frequency.linearRampToValueAtTime(freq + voice.detune, now + 5.0);
        });
        this.droneChangeTimer = 9999;

        this.attackDrumGain?.gain.setTargetAtTime(0, now, 0.6);
        this.attackBeatTime = null;
        this.heartbeatGain?.gain.setTargetAtTime(0, now, 0.6);
    }

    updateDronePitches(now) {
        if (!this.ambientVoices.length) return;
        const prev = this.currentDroneIdx;
        do {
            this.currentDroneIdx = Math.floor(Math.random() * this.dronePitches.length);
        } while (this.currentDroneIdx === prev && this.dronePitches.length > 1);

        const chord = this.dronePitches[this.currentDroneIdx];
        const ramp = 5 + Math.random() * 6; // 5–11 second frequency glide
        this.ambientVoices.forEach((voice, i) => {
            const freq = chord[i] ?? voice.freq;
            voice.osc.frequency.linearRampToValueAtTime(freq, now + ramp);
            voice.beat.frequency.linearRampToValueAtTime(freq + voice.detune, now + ramp * 1.03);
        });
    }

    updateAmbient(dt) {
        if (!this.enabled || !this.ctx || !this.ambientBus) return;

        // Fade in once the AudioContext is running (first keypress/click).
        if (!this.ambientReady && this.ctx.state === 'running') {
            this.ambientReady = true;
            this.ambientBus.gain.setTargetAtTime(1.0, this.ctx.currentTime + 0.5, 4.5);
        }

        // Harmonic walk - drones glide to a new pitch set every 12–28 seconds.
        this.droneChangeTimer -= dt;
        if (this.droneChangeTimer <= 0) {
            this.droneChangeTimer = 12 + Math.random() * 16;
            this.updateDronePitches(this.ctx.currentTime);
        }
    }

    // -------------------------------------------------------------------------
    // Pulse echo - distance-delayed, stereo-panned return ping per contact
    // -------------------------------------------------------------------------

    playPulseEcho(dx, dy, distance, chargeLevel) {
        if (!this.enabled || !this.ctx) return;

        const delay = distance / 1300;  // seconds - ~sonar return speed
        if (delay > 3.0) return;        // too far to hear

        const pan       = clamp(dx / 580, -1, 1);
        const proximity = clamp(1 - distance / 2200, 0, 1);
        const gain      = (0.022 + chargeLevel * 0.032) * Math.pow(proximity, 1.3);
        if (gain < 0.004) return;

        const now      = this.ctx.currentTime;
        // Same duration formula as playPulse but compressed to ~42% - shorter return, clearly not another fresh pulse
        const duration = (2.2 + chargeLevel * 1.8) * 0.42;
        // Same frequency region as the outgoing pulse so it sounds like the same tone coming back
        const rootFreq = 920 + chargeLevel * 520;

        // Lowpass above the fundamental - passes the main tone but strips upper harmonics
        // so it sounds muffled/returned rather than fresh
        const lowpass = this.ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = rootFreq * 2.2;
        lowpass.Q.value = 0.5;

        const panner = this.ctx.createStereoPanner();
        panner.pan.value = pan;

        const amp = this.ctx.createGain();
        amp.gain.setValueAtTime(0.0001, now + delay);
        amp.gain.exponentialRampToValueAtTime(gain, now + delay + 0.018);
        amp.gain.exponentialRampToValueAtTime(0.0001, now + delay + duration);

        // Two sawtooth partials - same character as the outgoing pulse, just fewer harmonics
        for (const [ratio, pgain, detune] of [[1.00, 0.68, -3], [1.51, 0.32, 4]]) {
            const osc = this.ctx.createOscillator();
            const pg  = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(rootFreq * ratio, now + delay);
            osc.detune.setValueAtTime(detune, now + delay);
            pg.gain.value = pgain;
            osc.connect(pg);
            pg.connect(lowpass);
            osc.start(now + delay);
            osc.stop(now + delay + duration + 0.08);
            osc.onended = () => { osc.disconnect(); pg.disconnect(); };
        }

        lowpass.connect(panner);
        panner.connect(amp);
        amp.connect(this.echoBus);

        if (this.fxReverbInput) {
            const send = this.ctx.createGain();
            send.gain.value = 0.52;
            amp.connect(send);
            send.connect(this.fxReverbInput);
        }
    }

    // -------------------------------------------------------------------------

    playShot() {
        this.resume();
        this.playTorpedoShot();
    }

    playTorpedoShot(options = {}) {
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime;
        const pitchScale = options.pitchScale ?? 1;
        const gainScale = options.gainScale ?? 1;
        const noiseScale = options.noiseScale ?? 1;
        const attack = 0.11;
        const sustain = 0.32;
        const decay = 0.39;
        const duration = attack + sustain + decay;
        const startFreq = (96 + 0.72 * 1200) * pitchScale;
        const peakFreq = startFreq * 1.14;
        const endFreq = Math.max(80, startFreq * 0.53);
        const masterGain = 0.77 * 0.18 * gainScale;

        const osc = this.ctx.createOscillator();
        const vibrato = this.ctx.createOscillator();
        const vibratoGain = this.ctx.createGain();
        const amp = this.ctx.createGain();
        const lowpass = this.ctx.createBiquadFilter();
        const highpass = this.ctx.createBiquadFilter();
        const shaper = this.ctx.createWaveShaper();
        const delay = this.ctx.createDelay(0.03);
        const flangerGain = this.ctx.createGain();
        const mix = this.ctx.createGain();
        const noiseSource = this.ctx.createBufferSource();
        const noiseFilter = this.ctx.createBiquadFilter();
        const noiseGain = this.ctx.createGain();
        const noiseBuffer = this.ctx.createBuffer(1, Math.ceil(duration * this.ctx.sampleRate), this.ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);

        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = Math.random() * 2 - 1;
        }

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(peakFreq, now + attack + sustain * 0.25);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
        osc.frequency.setValueAtTime(startFreq * 0.87, now + duration * 0.086);
        osc.frequency.setValueAtTime(startFreq * 0.80, now + duration * 0.22);

        vibrato.type = 'sine';
        vibrato.frequency.value = 5 + 0.96 * 18;
        vibratoGain.gain.value = startFreq * 0.66 * 0.055;
        vibrato.connect(vibratoGain);
        vibratoGain.connect(osc.frequency);

        amp.gain.setValueAtTime(0.0001, now);
        amp.gain.linearRampToValueAtTime(masterGain, now + attack);
        amp.gain.setValueAtTime(masterGain * 1.10, now + attack + sustain * 0.1);
        amp.gain.setValueAtTime(masterGain * 0.92, now + attack + sustain);
        amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        lowpass.type = 'lowpass';
        lowpass.frequency.setValueAtTime((520 + 0.62 * 4200) * pitchScale, now);
        lowpass.frequency.exponentialRampToValueAtTime(1800 * pitchScale, now + duration);
        lowpass.Q.value = 0.4;

        highpass.type = 'highpass';
        highpass.frequency.setValueAtTime((35 + 0.044 * 1600) * pitchScale, now);
        highpass.frequency.exponentialRampToValueAtTime(140 * pitchScale, now + duration);
        highpass.Q.value = 0.2;

        shaper.curve = this.createSoftBitcrushCurve(0.20);
        shaper.oversample = 'none';

        delay.delayTime.setValueAtTime(0.015, now);
        delay.delayTime.linearRampToValueAtTime(0.006, now + duration);
        flangerGain.gain.value = 0.22;

        noiseSource.buffer = noiseBuffer;
        noiseFilter.type = 'highpass';
        noiseFilter.frequency.setValueAtTime(420 * pitchScale, now);
        noiseFilter.frequency.exponentialRampToValueAtTime(260 * pitchScale, now + duration);
        noiseFilter.Q.value = 0.5;
        noiseGain.gain.setValueAtTime(0.0001, now);
        noiseGain.gain.linearRampToValueAtTime(masterGain * 0.72 * noiseScale, now + attack * 0.35);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + 0.18);

        osc.connect(lowpass);
        lowpass.connect(highpass);
        highpass.connect(shaper);
        shaper.connect(amp);
        amp.connect(mix);
        amp.connect(delay);
        delay.connect(flangerGain);
        flangerGain.connect(mix);
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(mix);
        mix.connect(this.fxBus);

        osc.start(now);
        vibrato.start(now);
        noiseSource.start(now);
        noiseSource.stop(now + duration);
        osc.stop(now + duration + 0.05);
        vibrato.stop(now + duration + 0.05);
        osc.onended = () => {
            osc.disconnect();
            vibrato.disconnect();
            vibratoGain.disconnect();
            lowpass.disconnect();
            highpass.disconnect();
            shaper.disconnect();
            amp.disconnect();
            delay.disconnect();
            flangerGain.disconnect();
            noiseSource.disconnect();
            noiseFilter.disconnect();
            noiseGain.disconnect();
            mix.disconnect();
        };
    }

    createSoftBitcrushCurve(amount = 0.2) {
        const n = 1024;
        const curve = new Float32Array(n);
        const steps = Math.max(8, Math.round(96 * (1 - amount) + 10));
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * 2 - 1;
            curve[i] = Math.round(x * steps) / steps;
        }
        return curve;
    }

    playEnemyShot() {
        this.resume();
        this.playTorpedoShot({ pitchScale: 0.58, gainScale: 0.72, noiseScale: 0.85 });
    }

    playDecloak() {
        this.resume();
        this.playTone({ frequency: 300, type: 'sawtooth', duration: 0.5, gain: 0.052, slideTo: 980, color: 'bandpass', filterFrequency: 760 });
        this.playTone({ frequency: 452, type: 'triangle', duration: 0.5, gain: 0.032, slideTo: 1360, color: 'bandpass', filterFrequency: 1180 });
        this.playNoise({ duration: 0.5, gain: 0.012, filterFrequency: 2400 });
    }

    playRecloak() {
        this.resume();
        this.playTone({ frequency: 1080, type: 'sawtooth', duration: 0.5, gain: 0.045, slideTo: 250, color: 'bandpass', filterFrequency: 820 });
        this.playTone({ frequency: 720, type: 'triangle', duration: 0.5, gain: 0.025, slideTo: 170, color: 'lowpass', filterFrequency: 520 });
        this.playNoise({ duration: 0.5, gain: 0.009, filterFrequency: 1400 });
    }

    playCommsSignal({ frequency = 1200, amplitude = 0.6, duration = 1.0 } = {}) {
        this.resume();
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime;
        const signalLevel = clamp(amplitude, 0.2, 1);
        const grains = Math.round(28 + 22 * signalLevel);
        const sampleRate = this.ctx.sampleRate;

        // ── Noise path - routed directly to ctx.destination, bypassing the analyser.
        // Loud and audible but invisible on the spectrum display.
        const noiseFilter = this.ctx.createBiquadFilter();
        const noiseGain = this.ctx.createGain();
        const noiseSource = this.ctx.createBufferSource();
        const noiseBuffer = this.ctx.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i++) {
            noiseData[i] = (Math.random() * 2 - 1) * (0.5 + Math.random() * 0.5);
        }
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = frequency;
        noiseFilter.Q.value = 2.2;
        noiseGain.gain.setValueAtTime(0.30 + signalLevel * 0.26, now);
        noiseGain.gain.setValueAtTime(0.30 + signalLevel * 0.26, now + Math.max(0.02, duration - 0.012));
        noiseGain.gain.linearRampToValueAtTime(0.0001, now + duration);
        noiseSource.buffer = noiseBuffer;
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(this.fxBus);
        noiseSource.start(now);
        noiseSource.stop(now + duration);
        noiseSource.onended = () => { noiseSource.disconnect(); noiseFilter.disconnect(); noiseGain.disconnect(); };

        // ── Tone grains - routed through fxBus so they appear as a spike on the spectrum display.
        const toneFilter = this.ctx.createBiquadFilter();
        const toneAmp = this.ctx.createGain();
        toneFilter.type = 'bandpass';
        toneFilter.frequency.value = frequency;
        toneFilter.Q.value = 8;
        toneAmp.gain.setValueAtTime(0.34 + signalLevel * 0.48, now);
        toneAmp.gain.setValueAtTime(0.34 + signalLevel * 0.48, now + Math.max(0.02, duration - 0.012));
        toneAmp.gain.linearRampToValueAtTime(0.0001, now + duration);
        toneFilter.connect(toneAmp);
        toneAmp.connect(this.fxBus);

        for (let i = 0; i < grains; i++) {
            const osc = this.ctx.createOscillator();
            const grainGain = this.ctx.createGain();
            const start = now + (i / grains) * duration;
            const grainDuration = Phaser.Math.FloatBetween(0.018, 0.045);
            const step = Phaser.Math.Between(-2, 2);
            const jitter = Phaser.Math.FloatBetween(0.96, 1.04);
            const steppedFrequency = frequency * Math.pow(2, step / 24) * jitter;

            osc.type = Math.random() < 0.72 ? 'square' : 'sawtooth';
            osc.frequency.setValueAtTime(Math.max(60, steppedFrequency), start);
            grainGain.gain.setValueAtTime(0.09 + signalLevel * 0.14, start);
            grainGain.gain.setValueAtTime(0.09 + signalLevel * 0.14, start + Math.max(0.006, grainDuration - 0.004));
            grainGain.gain.linearRampToValueAtTime(0.0001, start + grainDuration);

            osc.connect(grainGain);
            grainGain.connect(toneFilter);
            osc.start(start);
            osc.stop(start + grainDuration + 0.01);
            osc.onended = () => { osc.disconnect(); grainGain.disconnect(); };
        }

        setTimeout(() => { toneFilter.disconnect(); toneAmp.disconnect(); }, (duration + 0.2) * 1000);
    }

    playPulse(chargeLevel) {
        this.resume();
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime;
        const duration = 2.2 + chargeLevel * 1.8;
        const rootFrequency = 920 + chargeLevel * 520;
        const gain = 0.055 + chargeLevel * 0.075;

        const amp = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        const partials = [
            { ratio: 1.00, gain: 0.70, detune: -4 },
            { ratio: 1.51, gain: 0.36, detune:  5 },
            { ratio: 2.02, gain: 0.22, detune: -9 },
            { ratio: 2.73, gain: 0.12, detune:  7 },
        ];

        amp.gain.setValueAtTime(0.0001, now);
        amp.gain.exponentialRampToValueAtTime(gain, now + 0.018);
        amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        filter.type = 'bandpass';
        filter.frequency.value = rootFrequency * 1.75;
        filter.Q.value = 2.1;

        for (const partial of partials) {
            const osc = this.ctx.createOscillator();
            const partialGain = this.ctx.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(rootFrequency * partial.ratio, now);
            osc.detune.setValueAtTime(partial.detune, now);
            partialGain.gain.value = partial.gain;

            osc.connect(partialGain);
            partialGain.connect(filter);
            osc.start(now);
            osc.stop(now + duration + 0.08);
            osc.onended = () => { osc.disconnect(); partialGain.disconnect(); };
        }

        filter.connect(amp);
        amp.connect(this.fxBus);

        if (this.fxReverbInput) {
            const send = this.ctx.createGain();
            send.gain.value = 0.32;
            amp.connect(send);
            send.connect(this.fxReverbInput);
        }

        this.playNoise({ duration: 0.04, gain: 0.018 + chargeLevel * 0.018, filterFrequency: 2600 });
    }

    playShieldHit() {
        this.resume();
        this.playImpact({ pitchScale: 1, gainScale: 0.7, noiseScale: 0.4, decayScale: 1.5, boomScale: 1, reverb: 0.3 });
    }

    playHullHit() {
        this.resume();
        this.playImpact({ pitchScale: 0.3, gainScale: 1, noiseScale: 1, decayScale: 1, boomScale: 1, reverb: 0.1 });
    }

    playKill() {
        this.resume();
        this.playImpact({ pitchScale: 0.4, gainScale: 1.2, noiseScale: 1.5, decayScale: 2, boomScale: 2, reverb: 0.5 });
    }

    playMeteoroidPop() {
        this.resume();
        this.playImpact({ pitchScale: 0.2, gainScale: 0.2, noiseScale: 1.3, decayScale: 2, boomScale: 1, reverb: 0.3 });
    }

    playAsteroidBump() {
        this.resume();
        this.playImpact({ pitchScale: 0.2, gainScale: 0.5, noiseScale: 0.2, decayScale: 1, boomScale: 2, reverb: 0.2 });
    }

    playDeath() {
        this.resume();
        this.playImpact({ pitchScale: 0.4, gainScale: 1.5, noiseScale: 1.3, decayScale: 2, boomScale: 1.5, reverb: 0.3 });
        this.playImpact({ pitchScale: 0.3, gainScale: 1, noiseScale: 1.0, decayScale: 3, boomScale: 1, delay: 0.1, reverb: 0.5 });
        this.playImpact({ pitchScale: 1, gainScale: 0.4, noiseScale: 1.3, decayScale: 0.6, delay: 0.2, reverb: 0.2 });
    }

    playImpact(options = {}) {
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime + (options.delay ?? 0);
        const pitchScale = options.pitchScale ?? 1;
        const gainScale = options.gainScale ?? 1;
        const noiseScale = options.noiseScale ?? 1;
        const decayScale = options.decayScale ?? 1;
        const boomScale = options.boomScale ?? 0.75;
        const duration = 0.42 * decayScale;
        const startFreq = 250 * pitchScale;
        const endFreq = Math.max(24, startFreq * 0.32);
        const masterGain = 0.26 * gainScale;

        const osc = this.ctx.createOscillator();
        const amp = this.ctx.createGain();
        const boomAmp = this.ctx.createGain();
        const boomOsc = this.ctx.createOscillator();
        const noiseSource = this.ctx.createBufferSource();
        const noiseFilter = this.ctx.createBiquadFilter();
        const noiseGain = this.ctx.createGain();
        const mix = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(startFreq, now);
        osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
        amp.gain.setValueAtTime(0.0001, now);
        amp.gain.linearRampToValueAtTime(masterGain * 1.5, now + 0.012);
        amp.gain.exponentialRampToValueAtTime(masterGain * 0.35, now + 0.055);
        amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        osc.connect(amp);
        amp.connect(mix);

        boomOsc.type = 'sine';
        boomOsc.frequency.setValueAtTime(Math.max(28, startFreq * 0.32), now);
        boomOsc.frequency.exponentialRampToValueAtTime(Math.max(18, endFreq * 0.55), now + duration * 1.15);
        boomAmp.gain.setValueAtTime(0.0001, now);
        boomAmp.gain.linearRampToValueAtTime(masterGain * boomScale, now + 0.026);
        boomAmp.gain.exponentialRampToValueAtTime(0.0001, now + duration * 1.18);
        boomOsc.connect(boomAmp);
        boomAmp.connect(mix);

        noiseSource.buffer = this.createNoiseBuffer(duration);
        noiseFilter.type = 'lowpass';
        noiseFilter.frequency.setValueAtTime(4200, now);
        noiseFilter.frequency.exponentialRampToValueAtTime(700, now + duration);
        noiseFilter.Q.value = 0.45;
        noiseGain.gain.setValueAtTime(0.0001, now);
        noiseGain.gain.linearRampToValueAtTime(masterGain * 1.15 * noiseScale, now + 0.004);
        noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.9);
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(mix);
        mix.connect(this.fxBus);

        if (this.fxReverbInput && options.reverb) {
            const send = this.ctx.createGain();
            send.gain.value = options.reverb;
            mix.connect(send);
            send.connect(this.fxReverbInput);
            setTimeout(() => send.disconnect(), (duration + 0.8) * 1000);
        }

        osc.start(now);
        boomOsc.start(now);
        noiseSource.start(now);
        osc.stop(now + duration + 0.04);
        boomOsc.stop(now + duration * 1.2 + 0.04);
        noiseSource.stop(now + duration + 0.02);

        boomOsc.onended = () => {
            osc.disconnect();
            amp.disconnect();
            boomOsc.disconnect();
            boomAmp.disconnect();
            noiseSource.disconnect();
            noiseFilter.disconnect();
            noiseGain.disconnect();
            mix.disconnect();
        };
    }

    createNoiseBuffer(duration) {
        const sampleRate = this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            const tail = 1 - i / data.length;
            data[i] = (Math.random() * 2 - 1) * (0.35 + tail * 0.65);
        }
        return buffer;
    }

    playTone({ frequency, slideTo = null, type = 'sine', duration = 0.15, gain = 0.08, color = 'lowpass', filterFrequency = 1200 }) {
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const amp = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        osc.type = type;
        osc.frequency.setValueAtTime(frequency, now);
        if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + duration);

        filter.type = color;
        filter.frequency.value = filterFrequency;
        amp.gain.setValueAtTime(0.0001, now);
        amp.gain.exponentialRampToValueAtTime(gain, now + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        osc.connect(filter);
        filter.connect(amp);
        amp.connect(this.fxBus);
        osc.start(now);
        osc.stop(now + duration + 0.02);
        osc.onended = () => { osc.disconnect(); filter.disconnect(); amp.disconnect(); };
    }

    playNoise({ duration = 0.12, gain = 0.05, filterFrequency = 1000 }) {
        if (!this.enabled || !this.ctx) return;

        const now = this.ctx.currentTime;
        const sampleRate = this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, Math.ceil(duration * sampleRate), sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

        const source = this.ctx.createBufferSource();
        const amp = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();

        source.buffer = buffer;
        filter.type = 'bandpass';
        filter.frequency.value = filterFrequency;
        filter.Q.value = 2.5;
        amp.gain.setValueAtTime(gain, now);
        amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

        source.connect(filter);
        filter.connect(amp);
        amp.connect(this.fxBus);
        source.start(now);
        source.onended = () => { source.disconnect(); filter.disconnect(); amp.disconnect(); };
    }

    destroy() {
        if (!this.ctx) return;
        try { this.ctx.close(); } catch (_) {}
        this.ctx = null;
    }
}
