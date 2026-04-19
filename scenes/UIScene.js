// UIScene - HUD overlay, runs in parallel with GameScene.
// Reads game state via GameScene.getUIState() each frame and renders it.
//
// Layout:
//   Top-left  - title + compact control hints
//   Top-right - score + run state
//   Bottom panels (shared label row, left to right):
//     SHIP SYSTEMS  |  LONG RANGE SCANNER  |  SENSOR ANALYSIS

import { wrappedDelta } from '../utils/mathUtils.js';
import { drawBlipBrackets } from '../utils/renderUtils.js';

// Multiply the audio frequencies by 10^6 to make them look like radio
function formatFreqLabel(hz) {
    const mhz = Math.round(hz);
    if (mhz >= 1000) return (mhz / 1000).toFixed(1) + ' GHz';
    return mhz + ' MHz';
}

// Shared style for all three bottom-panel titles.
const PANEL_LABEL = {
    fontFamily: 'Share Tech Mono, monospace',
    fontSize: '10px',
    color: '#7fffdf'
};

// EM frequency/label per enemy type - keyed by enemy.constructor.type
const ENEMY_EM = {
    drifter: { freq: 108, label: 'DRIFTER' },
    seeker:  { freq: 175, label: 'SEEKER'  },
    burst:   { freq: 260, label: 'BURST'   },
};

export class UIScene extends Phaser.Scene {
    constructor() {
        super({ key: 'UIScene' });
    }

    create() {
        const W = this.scale.width;
        const H = this.scale.height;

        this.createVignette(W, H);

        const titleStyle = {
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '18px',
            fontStyle: '500',
            color: '#7fffdf'
        };
        const hintStyle = {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '13px',
            color: '#76b8aa'
        };
        const microStyle = {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '10px',
            color: '#76b8aa'
        };

        // Title + compact controls
        this.add.text(20, 18, 'PULSE', titleStyle).setAlpha(0.9);
        this.add.text(20, 48, 'WASD / ARROWS  MOVE', hintStyle).setAlpha(0.76);
        this.add.text(20, 64, 'SHIFT  FIRE', hintStyle).setAlpha(0.76);
        this.add.text(20, 80, 'SPACE  HOLD CHARGE / RELEASE PULSE', hintStyle).setAlpha(0.76);

        // Score - top-right
        this.add.text(W - 20, 18, 'SCORE', microStyle).setOrigin(1, 0).setAlpha(0.72);
        this.scoreText = this.add.text(W - 20, 32, '0', titleStyle).setOrigin(1, 0).setAlpha(0.9);
        this.runText = this.add.text(W - 20, 58, 'x1  00:00', microStyle).setOrigin(1, 0).setAlpha(0.8);

        // Bottom instrument layout. Side panels are symmetric around the centered radar.
        this.instrumentY = H - 205;
        this.panelMargin = 20;
        this.panelGap = 22;
        this.radarW = 170;
        this.radarH = 170;
        this.radarRadius = 85;
        this.radarRange = 2400;
        this.radarX = (W - this.radarW) / 2;
        this.radarY = H - this.radarH - 20;
        this.sidePanelW = Math.max(280, this.radarX - this.panelMargin - this.panelGap);
        this.instrumentX = this.panelMargin;
        this.energyBarW = this.sidePanelW;
        this.spectrumW = this.sidePanelW;
        this.spectrumH = 170;
        this.spectrumX = W - this.panelMargin - this.spectrumW;
        this.spectrumY = H - this.spectrumH - 20;

        this.add.text(this.instrumentX, this.instrumentY, 'SHIP SYSTEMS', PANEL_LABEL).setAlpha(0.78);
        this.add.text(this.instrumentX, this.instrumentY + 20, 'SHIELD',         microStyle).setAlpha(0.82);
        this.add.text(this.instrumentX, this.instrumentY + 48, 'HULL',           microStyle).setAlpha(0.82);
        this.add.text(this.instrumentX, this.instrumentY + 76, 'ENERGY',         microStyle).setAlpha(0.82);
        this.add.text(this.instrumentX, this.instrumentY + 104, 'SCANNER CHARGE', microStyle).setAlpha(0.82);

        // Live graphics - redrawn each frame in update()
        this.energyBarGfx = this.add.graphics();
        this.capBarGfx    = this.add.graphics();

        this.gameOverText = this.add.text(W / 2, H / 2 - 46, 'SIGNAL LOST', {
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '34px',
            fontStyle: '700',
            color: '#ff6655'
        }).setOrigin(0.5).setAlpha(0).setDepth(1200);
        this.finalScoreText = this.add.text(W / 2, H / 2, 'SCORE 0', {
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '24px',
            fontStyle: '700',
            color: '#7fffdf'
        }).setOrigin(0.5).setAlpha(0).setDepth(1200);
        this.newRecordText = this.add.text(W / 2, H / 2 + 28, '', {
            fontFamily: 'Orbitron, sans-serif',
            fontSize: '13px',
            fontStyle: '700',
            color: '#ffdd44'
        }).setOrigin(0.5).setAlpha(0).setDepth(1200);
        const scoreRowStyle = {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '11px',
            color: '#7fffdf'
        };
        this.highScoreRows = [];
        for (let i = 0; i < 5; i++) {
            this.highScoreRows.push(
                this.add.text(W / 2, H / 2 + 50 + i * 15, '', scoreRowStyle)
                    .setOrigin(0.5).setAlpha(0).setDepth(1200)
            );
        }
        this.restartText = this.add.text(W / 2, H / 2 + 138, 'R / ENTER TO RESTART', hintStyle)
            .setOrigin(0.5)
            .setAlpha(0)
            .setDepth(1200);

        // Sensor analysis - bottom-right (createSpectrumDisplay reads this.instrumentY)
        this.createSpectrumDisplay(W, H);

        // Radar - bottom-center (createRadar reads this.instrumentY)
        this.createRadar(W, H);

        // Debug overlay - F1 to toggle
        this.debugMode = false;
        this.debugGfx  = this.add.graphics().setDepth(900);
        this.debugLabels = [];
        this.debugBadge = this.add.text(W / 2, 20, 'EM DEBUG', {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '10px',
            color: '#ff9944'
        }).setOrigin(0.5, 0).setDepth(902).setAlpha(0);
        this.input.keyboard.addCapture(Phaser.Input.Keyboard.KeyCodes.F1);
        this.input.keyboard.on('keydown-F1', event => {
            event.preventDefault();
            this.debugMode = !this.debugMode;
            this.debugBadge.setAlpha(this.debugMode ? 0.80 : 0);
            if (!this.debugMode) {
                this.debugGfx.clear();
                for (const t of this.debugLabels) t.setAlpha(0);
            }
        });
    }

    update() {
        const game = this.scene.get('GameScene');
        if (!game || !game.energy) return;
        const state = game.getUIState();
        this.drawShipBars(state);
        this.drawRadar(state);
        this.drawSpectrum(state);
        this.drawRunState(state);
        if (this.debugMode) this.drawDebug(state);
    }

    drawRunState(state) {
        this.scoreText.setText(String(state.score ?? 0));

        const t = Math.floor(state.survivalTime ?? 0);
        const minutes = Math.floor(t / 60).toString().padStart(2, '0');
        const seconds = (t % 60).toString().padStart(2, '0');
        this.runText.setText(`x${state.multiplier ?? 1}  ${minutes}:${seconds}`);

        this.gameOverText.setAlpha(state.gameOver ? 0.9 : 0);
        this.finalScoreText.setText(`SCORE ${state.score ?? 0}`);
        this.finalScoreText.setAlpha(state.gameOver ? 0.9 : 0);
        this.restartText.setAlpha(state.gameOver ? 0.62 : 0);

        if (state.gameOver) {
            const rank = state.newHighScoreRank;
            if (rank !== null && rank !== undefined) {
                this.newRecordText.setText(rank === 1 ? 'NEW HIGH SCORE' : `NEW RECORD  #${rank}`).setAlpha(0.95);
            } else {
                this.newRecordText.setAlpha(0);
            }

            const scores = state.highScores ?? [];
            for (let i = 0; i < this.highScoreRows.length; i++) {
                const row = this.highScoreRows[i];
                if (i < scores.length) {
                    const s = scores[i];
                    const tt = Math.floor(s.survivalTime ?? 0);
                    const mm = Math.floor(tt / 60).toString().padStart(2, '0');
                    const ss = (tt % 60).toString().padStart(2, '0');
                    const rankMark = (rank !== null && rank - 1 === i) ? '>' : ' ';
                    row.setText(`${rankMark}${i + 1}  ${String(s.score).padStart(5, ' ')}  ${mm}:${ss}`);
                    row.setAlpha(i === 0 ? 0.90 : 0.72);
                } else {
                    row.setAlpha(0);
                }
            }
        } else {
            this.newRecordText.setAlpha(0);
            for (const row of this.highScoreRows) row.setAlpha(0);
        }
    }

    drawShipBars(state) {
        const energy = state.energy;
        const g    = this.energyBarGfx;
        const capG = this.capBarGfx;
        g.clear();
        capG.clear();

        const x      = this.instrumentX;
        const barY   = this.instrumentY + 34;
        const totalW = this.energyBarW;
        const segH   = 6;

        this.drawSegmentBar(g, x, barY,      totalW, segH, 10, energy.shieldFraction, 0x66aaff, 0.18);
        this.drawFillBar   (g, x, barY + 28, totalW, segH, (state.hull ?? 0) / (state.maxHull ?? 3), 0xff6655, 0.18);
        this.drawSegmentBar(g, x, barY + 56, totalW, segH, 10, energy.fraction, energy.isLow ? 0xff6655 : 0x7fffdf, 0.18);
        this.drawSegmentBar(capG, x, barY + 84, totalW, segH, 10, energy.capFraction, 0xffcc88, 0.16);

        this.drawBarFlash(g, x, barY,      totalW, segH, 0x66aaff, (state.shieldHitFlash ?? 0) / 0.34);
        this.drawBarFlash(g, x, barY + 28, totalW, segH, 0xff6655, (state.hullHitFlash  ?? 0) / 0.46);
    }

    drawSegmentBar(g, x, y, width, height, segments, fraction, color, emptyAlpha) {
        const segW    = (width / segments) - 1;
        const clamped = Math.max(0, Math.min(1, fraction));
        const filled  = clamped >= 1 ? segments : Math.floor(clamped * segments);
        for (let i = 0; i < segments; i++) {
            g.fillStyle(color, i < filled ? 0.86 : emptyAlpha);
            g.fillRect(x + i * (segW + 1), y, segW, height);
        }
    }

    drawFillBar(g, x, y, width, height, fraction, color, emptyAlpha) {
        const clamped = Math.max(0, Math.min(1, fraction));
        g.fillStyle(color, emptyAlpha);
        g.fillRect(x, y, width, height);
        g.fillStyle(color, 0.86);
        g.fillRect(x, y, width * clamped, height);
    }

    drawBarFlash(g, x, y, width, height, color, amount) {
        const alpha = Math.max(0, Math.min(1, amount));
        if (alpha <= 0) return;
        g.fillStyle(color, alpha * 0.55);
        g.fillRect(x - 2, y - 2, width + 4, height + 4);
    }

    createVignette(W, H) {
        const v = this.add.graphics();
        const steps = 24;
        const maxInset = 180;
        for (let i = 0; i < steps; i++) {
            const t = i / (steps - 1);
            v.lineStyle(6, 0x000000, t * t * 0.55);
            v.strokeRect(-(1 - t) * maxInset, -(1 - t) * maxInset,
                         W + (1 - t) * maxInset * 2, H + (1 - t) * maxInset * 2);
        }
        v.setDepth(1000);
    }

    createRadar(W, H) {
        this.radarGfx    = this.add.graphics().setDepth(100);

        // Label aligned to the shared panel label row
        this.add.text(W / 2, this.instrumentY, 'LONG RANGE SCANNER', PANEL_LABEL)
            .setOrigin(0.5, 0).setAlpha(0.78);
    }

    drawRadar(state) {
        const g  = this.radarGfx;
        g.clear();

        const cx = this.radarX + this.radarRadius;
        const cy = this.radarY + this.radarRadius;
        const rr = this.radarRadius;
        const sc = rr / this.radarRange;

        const toRadar = (wx, wy) => {
            const dx = wrappedDelta(state.player.x, wx, state.worldSize);
            const dy = wrappedDelta(state.player.y, wy, state.worldSize);
            return { x: cx + dx * sc, y: cy + dy * sc, dist: Math.sqrt(dx * dx + dy * dy) };
        };

        g.fillStyle(0x000810, 0.9);
        g.fillCircle(cx, cy, rr);

        g.lineStyle(1, 0x7fffdf, 0.10);
        g.strokeCircle(cx, cy, rr * 0.33);
        g.strokeCircle(cx, cy, rr * 0.66);
        g.lineBetween(cx, cy - rr, cx, cy + rr);
        g.lineBetween(cx - rr, cy, cx + rr, cy);

        for (const pulse of state.pulses) {
            const p  = toRadar(pulse.originX, pulse.originY);
            if (p.dist - pulse.currentRadius > this.radarRange) continue;
            const pr = pulse.currentRadius * sc;
            const t  = pulse.currentRadius / pulse.maxRadius;
            g.lineStyle(1, 0x7fffdf, (1 - t) * 0.68);
            g.strokeCircle(p.x, p.y, pr);
        }

        for (const echo of (state.echoRings ?? [])) {
            const e  = toRadar(echo.x, echo.y);
            if (e.dist - echo.currentRadius > this.radarRange) continue;
            const er = echo.currentRadius * sc;
            const t  = echo.currentRadius / echo.maxRadius;
            g.lineStyle(1, 0xffbb44, (1 - t) * 0.38 * echo.strength);
            g.strokeCircle(e.x, e.y, er);
        }

        for (const blip of state.radarBlips) {
            const b = toRadar(blip.x, blip.y);
            if (b.dist > this.radarRange) continue;
            if (blip.type === 'asteroid') continue;
            const life = 1 - blip.age / blip.lifetime;
            const snap = Math.max(0, 1 - blip.age / blip.snap);
            const alpha = Math.min(1, Math.max(0, life) * blip.strength + snap * 0.45);
            const blipColor = blip.type === 'comms' ? 0xff3344 : 0x4dff88;
            drawBlipBrackets(g, b.x, b.y, 5.5 + snap * 2, 2.5, blipColor, 0.18 + alpha * 0.82, 1);
        }

        g.fillStyle(0xffddaa, 1.0);
        g.fillCircle(cx, cy, 3);

        g.lineStyle(1, 0x7fffdf, 0.58);
        g.strokeCircle(cx, cy, rr);
    }

    createSpectrumDisplay(W, H) {
        this.spectrumBarH = 64;    // scan line sits at spectrumY + spectrumBarH
        this.spectrumBins = 64;
        this.waterfallRows = 50;
        this.waterfall      = [];
        this.commsWaterfall = [];
        this.echoWaterfall  = [];
        this.waterfallTimer = 0;
        this.spectrumGfx  = this.add.graphics().setDepth(100);
        this.gainControlW = 42;
        this.gainSliderTop = this.spectrumY + 34;
        this.gainSliderH = 112;
        this.gainSliderX = this.spectrumX + 18;
        this.isDraggingGain = false;

        // Panel label aligned to shared label row - sits above the panel background
        this.add.text(this.spectrumX, this.instrumentY, 'SENSOR ANALYSIS', PANEL_LABEL).setAlpha(0.78);
        this.add.text(this.gainSliderX, this.gainSliderTop - 13, 'GAIN', {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '7px',
            color: '#7fffdf'
        }).setOrigin(0.5, 0).setDepth(101).setAlpha(0.64);

        // Frequency axis labels - fixed positions on the log scale (30–3800 Hz shown as MHz/GHz)
        const { graphX, graphW } = this.getSpectrumGraphMetrics();
        const fMin = 30, fMax = 3800;
        const logMin   = Math.log(fMin);
        const logMax   = Math.log(fMax);
        const freqLabelY = this.spectrumY + this.spectrumBarH + 3;   // just below scan line

        const freqTextStyle = {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '9px',
            color: '#7fffdf'
        };
        // Nice round frequencies for grid lines (Hz internally, shown as MHz/GHz)
        const niceFreqs = [50, 100, 200, 500, 1000, 2000];
        this.niceGridTs = niceFreqs.map(f => (Math.log(f) - logMin) / (logMax - logMin));
        this.freqAxisLabels = [];
        for (let i = 0; i < niceFreqs.length; i++) {
            const gx = graphX + graphW * this.niceGridTs[i];
            const t = this.add.text(gx, freqLabelY, formatFreqLabel(niceFreqs[i]), freqTextStyle)
                .setOrigin(0.5, 0).setDepth(101).setAlpha(0.58);
            this.freqAxisLabels.push(t);
        }

        // Peak marker labels - repositioned each frame to track strongest EM peaks
        const peakTextStyle = {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '9px',
            color: '#4dff88'
        };
        this.peakMarkerLabels = [];
        for (let i = 0; i < 4; i++) {
            const t = this.add.text(0, 0, '', peakTextStyle)
                .setOrigin(0.5, 1).setDepth(102).setAlpha(0);
            this.peakMarkerLabels.push(t);
        }

        this.commsHeaderText = this.add.text(this.spectrumX + this.gainControlW + 8, this.spectrumY + this.spectrumH - 24, '', {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '10px',
            color: '#ff3344'
        }).setOrigin(0, 1).setDepth(103).setAlpha(0);

        this.commsText = this.add.text(this.spectrumX + this.gainControlW + 8, this.spectrumY + this.spectrumH - 11, '', {
            fontFamily: 'Share Tech Mono, monospace',
            fontSize: '10px',
            color: '#e8e8d0'
        }).setOrigin(0, 1).setDepth(103).setAlpha(0);

        this.createGainSliderInput();
    }

    getSpectrumGraphMetrics() {
        const pad = 8;
        const graphX = this.spectrumX + this.gainControlW + pad;
        const graphW = this.spectrumW - this.gainControlW - pad * 2;
        return { pad, graphX, graphW };
    }

    createGainSliderInput() {
        const hit = this.add.zone(
            this.gainSliderX,
            this.gainSliderTop + this.gainSliderH / 2,
            30,
            this.gainSliderH + 24
        ).setOrigin(0.5).setDepth(150).setInteractive({ useHandCursor: true });

        hit.on('pointerdown', pointer => {
            this.isDraggingGain = true;
            this.setGainFromPointer(pointer);
        });
        this.input.on('pointermove', pointer => {
            if (this.isDraggingGain) this.setGainFromPointer(pointer);
        });
        this.input.on('pointerup', () => {
            this.isDraggingGain = false;
        });
        this.input.on('pointerupoutside', () => {
            this.isDraggingGain = false;
        });
    }

    setGainFromPointer(pointer) {
        const game = this.scene.get('GameScene');
        const position = 1 - Phaser.Math.Clamp((pointer.y - this.gainSliderTop) / this.gainSliderH, 0, 1);
        const raw = position * 2;
        game?.audioSystem?.setEffectsGain?.(raw);
    }

    drawGainSlider(g, value) {
        const gain = Phaser.Math.Clamp(value, 0, 2);
        const position = gain / 2;
        const x = this.gainSliderX;
        const top = this.gainSliderTop;
        const bottom = top + this.gainSliderH;
        const mid = top + this.gainSliderH * 0.5;
        const knobY = bottom - position * this.gainSliderH;

        g.lineStyle(1, 0x7fffdf, 0.16);
        g.lineBetween(x, top, x, bottom);
        g.lineStyle(1, 0xffddaa, 0.38);
        g.lineBetween(x - 6, mid, x + 6, mid);
        g.lineStyle(2, gain >= 1 ? 0xffddaa : 0x4dff88, 0.28 + Math.abs(gain - 1) * 0.38);
        g.lineBetween(x, mid, x, knobY);

        for (let i = 0; i <= 4; i++) {
            const ty = top + (this.gainSliderH * i) / 4;
            const alpha = i === 0 || i === 4 ? 0.36 : 0.20;
            g.lineStyle(1, 0x7fffdf, alpha);
            g.lineBetween(x - 4, ty, x + 4, ty);
        }

        g.fillStyle(0x000810, 0.92);
        g.fillCircle(x, knobY, 7);
        g.lineStyle(1.4, 0x7fffdf, this.isDraggingGain ? 0.95 : 0.72);
        g.strokeCircle(x, knobY, 6);
        g.fillStyle(gain >= 1 ? 0xffddaa : 0x4dff88, 0.64 + Math.abs(gain - 1) * 0.26);
        g.fillCircle(x, knobY, 2.7);
    }

    applySpectrumGain(values, gain) {
        return values.map(v => Math.max(0, Math.min(1, v * gain)));
    }

    drawSpectrum(state) {
        const g = this.spectrumGfx;
        g.clear();

        const x = this.spectrumX;
        const y = this.spectrumY;
        const w = this.spectrumW;
        const h = this.spectrumH;

        // Vertical layout
        const labelRowY   = y + 12;                        // peak label row (text bottom-anchor)
        const barTop      = y + 14;                        // bars start below label row
        const barH        = 46;
        const scanLineY   = y + this.spectrumBarH;         // y + 64
        const waterfallTop = scanLineY + 16;               // 16 px gap (holds freq labels)
        const waterfallH  = h - this.spectrumBarH - 20;   // 170 - 64 - 20 = 86

        const sampleRate = state.audioSystem?.ctx?.sampleRate ?? 44100;
        const sensorGain = state.audioSystem?.getEffectsGain?.() ?? 1;
        const visualGain = sensorGain * 2.05;
        const totalBins  = this.applySpectrumGain(
            this.sampleSpectrumBinsLog(state.audioSystem?.getSpectrumData?.(), this.spectrumBins, sampleRate),
            visualGain
        );
        const emBins   = this.applySpectrumGain(
            this.sampleSpectrumBinsLog(state.audioSystem?.getEmSpectrumData?.(), this.spectrumBins, sampleRate),
            visualGain
        );
        const echoBins = this.applySpectrumGain(
            this.sampleSpectrumBinsLog(state.audioSystem?.getEchoSpectrumData?.(), this.spectrumBins, sampleRate),
            visualGain * 1.4   // slight boost - echo pings are quieter than EM voices
        );
        const comms = state.comms;
        const commsActive = comms && comms.age < comms.signalLifetime;

        // Waterfall from EM-only so weapons/engine don't streak
        this.waterfallTimer += this.game.loop.delta / 1000;
        if (this.waterfallTimer >= 0.075) {
            this.waterfallTimer = 0;
            this.waterfall.unshift(emBins.slice());
            if (this.waterfall.length > this.waterfallRows) this.waterfall.pop();
            this.echoWaterfall.unshift(echoBins.slice());
            if (this.echoWaterfall.length > this.waterfallRows) this.echoWaterfall.pop();
            this.commsWaterfall.unshift(commsActive ? {
                frequency: comms.frequency,
                amplitude: Math.max(0, Math.min(1, comms.amplitude * sensorGain))
            } : null);
            if (this.commsWaterfall.length > this.waterfallRows) this.commsWaterfall.pop();
        }

        // Background - no border
        g.fillStyle(0x000810, 0.86);
        g.fillRect(x, y, w, h);
        this.drawGainSlider(g, sensorGain);

        const { graphX, graphW } = this.getSpectrumGraphMetrics();
        const binW   = graphW / this.spectrumBins;

        // Scan line: keep it inside the graph area so it does not cross the gain control.
        g.lineStyle(1, 0x7fffdf, 0.28);
        g.lineBetween(graphX, scanLineY, graphX + graphW, scanLineY);

        // Vertical grid lines at nice freq positions
        g.lineStyle(1, 0x7fffdf, 0.08);
        for (const t of this.niceGridTs) {
            const gx = graphX + graphW * t;
            g.lineBetween(gx, barTop, gx, waterfallTop + waterfallH);
        }

        // Layer 1 - blue-grey: all signals (engine, weapons, enemies)
        for (let i = 0; i < totalBins.length; i++) {
            const bar = Math.pow(totalBins[i], 0.72);
            if (bar < 0.01) continue;
            g.fillStyle(0x5599bb, 0.35 + bar * 0.50);
            g.fillRect(graphX + i * binW + 1, barTop + barH * (1 - bar), Math.max(1, binW - 2), barH * bar);
        }

        // Layer 2 - green/red: EM-only enemy contacts
        for (let i = 0; i < emBins.length; i++) {
            const v   = emBins[i];
            const bar = Math.pow(v, 0.72);
            if (bar < 0.01) continue;
            const color = v > 0.60 ? 0xff6655 : 0x4dff88;
            g.fillStyle(color, 0.20 + bar * 0.78);
            g.fillRect(graphX + i * binW + 1, barTop + barH * (1 - bar), Math.max(1, binW - 2), barH * bar);
        }

        // Layer 3 - amber: pulse echo return pings
        for (let i = 0; i < echoBins.length; i++) {
            const bar = Math.pow(echoBins[i], 0.68);
            if (bar < 0.01) continue;
            g.fillStyle(0xffbb44, 0.18 + bar * 0.72);
            g.fillRect(graphX + i * binW + 1, barTop + barH * (1 - bar), Math.max(1, binW - 2), barH * bar);
        }

        // Waterfall - EM contacts (green/red) and echo returns (amber)
        const rowH = waterfallH / this.waterfallRows;
        for (let row = 0; row < this.waterfall.length; row++) {
            const emRow   = this.waterfall[row];
            const echoRow = this.echoWaterfall[row];
            for (let i = 0; i < emRow.length; i++) {
                const v = emRow[i];
                if (v >= 0.018) {
                    const color = v > 0.55 ? 0xff6655 : 0x4dff88;
                    g.fillStyle(color, Math.min(0.88, 0.12 + v * 1.15));
                    g.fillRect(graphX + i * binW, waterfallTop + row * rowH, Math.ceil(binW), Math.ceil(rowH));
                }
                if (echoRow) {
                    const ev = echoRow[i];
                    if (ev >= 0.018) {
                        g.fillStyle(0xffbb44, Math.min(0.72, 0.08 + ev * 0.95));
                        g.fillRect(graphX + i * binW, waterfallTop + row * rowH, Math.ceil(binW), Math.ceil(rowH));
                    }
                }
            }
        }
        this.drawCommsSignal(g, comms, {
            graphX,
            graphW,
            binW,
            barTop,
            barH,
            waterfallTop,
            waterfallH,
            rowH,
            sensorGain
        });

        // Peak frequency markers - find local EM maxima; labels pinned to fixed row with nudging
        const fMin = 30, fMax = 3800;
        const logMin = Math.log(fMin);
        const logMax = Math.log(fMax);
        const nBins  = this.spectrumBins;

        const peaks = [];
        for (let i = 1; i < emBins.length - 1; i++) {
            const v = emBins[i];
            if (v > 0.30 && v >= emBins[i - 1] && v >= emBins[i + 1]) {
                const freqHz = Math.exp(logMin + ((i + 0.5) / nBins) * (logMax - logMin));
                peaks.push({ i, v, freqHz });
            }
        }
        peaks.sort((a, b) => b.v - a.v);
        const topPeaks = peaks.slice(0, this.peakMarkerLabels.length);
        topPeaks.sort((a, b) => a.i - b.i);   // sort by x-position for nudging

        // Greedy nudge: push overlapping label positions apart while keeping order
        const positions = topPeaks.map(p => graphX + p.i * binW + binW * 0.5);
        const minSep = 42;
        for (let iter = 0; iter < 10; iter++) {
            let moved = false;
            for (let j = 0; j < positions.length - 1; j++) {
                const gap = positions[j + 1] - positions[j];
                if (gap < minSep) {
                    const push = (minSep - gap) * 0.5;
                    positions[j]     = Math.max(graphX + 20, positions[j] - push);
                    positions[j + 1] = Math.min(graphX + graphW - 20, positions[j + 1] + push);
                    moved = true;
                }
            }
            if (!moved) break;
        }

        for (let p = 0; p < this.peakMarkerLabels.length; p++) {
            const label = this.peakMarkerLabels[p];
            if (p >= topPeaks.length) { label.setAlpha(0); continue; }

            const peak = topPeaks[p];
            const bar  = Math.pow(peak.v, 0.72);
            const bx   = graphX + peak.i * binW + binW * 0.5;
            const by   = barTop + barH * (1 - bar);
            const lx   = positions[p];

            // Stem from label bottom to bar tip
            g.lineStyle(1, 0x7fffdf, 0.30);
            g.lineBetween(lx, labelRowY + 2, bx, by);

            // Small downward triangle at bar tip
            g.fillStyle(0x7fffdf, 0.80);
            g.fillTriangle(bx - 3, by - 5, bx + 3, by - 5, bx, by);

            label.setPosition(lx, labelRowY);
            label.setText(formatFreqLabel(peak.freqHz));
            label.setAlpha(0.90);
        }
        this.drawCommsMessage(comms, graphX, graphW);
    }

    drawCommsSignal(g, comms, layout) {
        const {
            graphX, graphW, binW, barTop, barH, waterfallTop, rowH, sensorGain
        } = layout;

        const fMin = 30;
        const fMax = 3800;
        const logMin = Math.log(fMin);
        const logMax = Math.log(fMax);
        const freqToBin = hz => Math.round(
            (Math.log(Math.max(fMin, Math.min(fMax, hz))) - logMin) / (logMax - logMin) * (this.spectrumBins - 1)
        );

        for (let row = 0; row < this.commsWaterfall.length; row++) {
            const item = this.commsWaterfall[row];
            if (!item) continue;
            const bi = freqToBin(item.frequency);
            const alpha = Math.min(0.9, item.amplitude * (1 - row / this.waterfallRows) * 1.25);
            if (alpha <= 0.02) continue;
            g.fillStyle(0xff3344, alpha);
            g.fillRect(graphX + bi * binW, waterfallTop + row * rowH, Math.ceil(binW), Math.ceil(rowH));
        }

        if (!comms || comms.age >= comms.signalLifetime) return;

        const life = 1 - comms.age / comms.signalLifetime;
        const amp = Math.max(0, Math.min(1, comms.amplitude * sensorGain));
        const spike = Math.max(0.08, amp) * (0.55 + life * 0.45);
        const bi = freqToBin(comms.frequency);
        const spikeH = barH * Math.min(1, spike * 1.35);
        const color = comms.isBroken ? 0xff9966 : 0xff3344;
        g.fillStyle(color, 0.20 + spike * 0.78);
        g.fillRect(graphX + bi * binW + 1, barTop + barH - spikeH, Math.max(1, binW - 2), spikeH);
    }

    drawCommsMessage(comms, graphX, graphW) {
        if (!comms) {
            this.commsText.setAlpha(0);
            this.commsHeaderText.setAlpha(0);
            return;
        }

        const life = 1 - comms.age / comms.lifetime;
        const alpha = Math.max(0, Math.min(1, life * 1.35));
        const maxChars = Math.max(20, Math.floor(graphW / 7));

        this.commsHeaderText
            .setText(comms.header ?? '')
            .setPosition(graphX, this.spectrumY + this.spectrumH - 24)
            .setAlpha(alpha * 0.92);

        const bodyColor = comms.isBroken ? '#ff9966' : '#e8e8d0';
        const bodyText = comms.text ?? '';
        this.commsText
            .setColor(bodyColor)
            .setText(bodyText.length > maxChars ? bodyText.slice(0, maxChars - 2) + '..' : bodyText)
            .setPosition(graphX, this.spectrumY + this.spectrumH - 11)
            .setAlpha(alpha * 0.88);
    }

    drawDebug(state) {
        const g   = this.debugGfx;
        g.clear();
        const cam = state.cam;
        const W   = this.scale.width;
        const H   = this.scale.height;

        const toScreen = (wx, wy) => ({
            x: wx - cam.scrollX,
            y: wy - cam.scrollY
        });

        // Log-scale x position on the spectrum display for a given frequency (Hz)
        const fMin = 30, fMax = 3800;
        const logMin = Math.log(fMin), logMax = Math.log(fMax);
        const { graphX, graphW } = this.getSpectrumGraphMetrics();
        const specY  = this.spectrumY;
        const freqToSpecX = hz => graphX + graphW * (Math.log(Math.max(fMin, Math.min(fMax, hz))) - logMin) / (logMax - logMin);

        // Lazily create/reuse debug label Text objects
        let labelIdx = 0;
        const makeLabel = (colorStr, text, x, y, alpha = 0.85) => {
            let t;
            if (labelIdx < this.debugLabels.length) {
                t = this.debugLabels[labelIdx];
            } else {
                t = this.add.text(0, 0, '', {
                    fontFamily: 'Share Tech Mono, monospace',
                    fontSize: '9px'
                }).setDepth(901);
                this.debugLabels.push(t);
            }
            labelIdx++;
            t.setColor(colorStr).setPosition(x, y).setText(text).setAlpha(alpha);
        };

        // Small strength bar drawn horizontally at (x, y), width proportional to strength 0–1
        const strengthBar = (x, y, strength, color, alpha = 0.70) => {
            const barW = Math.round(strength * 36);
            g.fillStyle(0x111111, 0.55);
            g.fillRect(x, y, 36, 4);
            if (barW > 0) {
                g.fillStyle(color, alpha);
                g.fillRect(x, y, barW, 4);
            }
        };

        // Small downward tick on spectrum panel at a given frequency
        const specTick = (hz, color, alpha = 0.75) => {
            const sx = freqToSpecX(hz);
            g.fillStyle(color, alpha);
            g.fillTriangle(sx - 3, specY + 1, sx + 3, specY + 1, sx, specY + 5);
        };

        const ps = toScreen(state.player.x, state.player.y);
        const debugSignals = [];

        // --- Engine drone ---
        // Strength: idle gain ≈ 0.018, full thrust ≈ 0.093 - normalize to 0–1
        const thrust    = Math.abs(state.player.thrustInput);
        const forward   = state.player.thrustInput > 0 ? 1 : 0;
        const engGain   = 0.018 + thrust * (forward ? 0.075 : 0.035);
        const engStr    = Math.min(1, engGain / 0.093);
        const thrustHz  = Math.round(34 + thrust * (forward ? 24 : 12));
        g.lineStyle(1, 0x5599bb, 0.50);
        g.strokeCircle(ps.x, ps.y, 22);
        makeLabel('#5599bb', `ENGINE ~${thrustHz} MHz`, ps.x + 24, ps.y - 10);
        strengthBar(ps.x + 24, ps.y + 1, engStr, 0x5599bb);
        specTick(thrustHz, 0x5599bb);
        debugSignals.push({ label: 'ENGINE', strength: engStr, color: 0x5599bb, colorStr: '#5599bb' });

        // --- Charge tone ---
        // Strength: 0.008 + capFrac * 0.018 - normalize to 0.008–0.026
        const capFrac = state.energy?.capFraction ?? 0;
        if (capFrac > 0.01) {
            const chargeHz  = Math.round(82 + capFrac * 260);
            const chargeGain = 0.008 + capFrac * 0.018;
            const chargeStr  = Math.min(1, (chargeGain - 0.008) / 0.018);
            makeLabel('#ffcc88', `CHARGE ${chargeHz} MHz`, ps.x + 24, ps.y + 7);
            strengthBar(ps.x + 24, ps.y + 18, chargeStr, 0xffcc88);
            specTick(chargeHz, 0xffcc88);
            debugSignals.push({ label: 'CHARGE', strength: chargeStr, color: 0xffcc88, colorStr: '#ffcc88' });
        }

        // --- Enemy EM voices ---
        for (const enemy of state.enemies ?? []) {
            if (!enemy.active) continue;

            const dx   = wrappedDelta(state.player.x, enemy.x, state.worldSize);
            const dy   = wrappedDelta(state.player.y, enemy.y, state.worldSize);
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const inRange = dist < 1450;

            const proximity  = Math.max(0, 1 - dist / 1450);
            const closeBoost = Math.pow(proximity, 1.7);
            const voiceGain  = 0.01 + closeBoost * 0.18;
            const voiceStr = Math.min(1, Math.max(0, (voiceGain - 0.01) / 0.18));

            const info = ENEMY_EM[enemy.constructor.type] ?? { freq: 108, label: 'ENEMY' };
            const nx = dx / dist;
            const ny = dy / dist;
            const enemyVX = enemy.body?.velocity?.x ?? 0;
            const enemyVY = enemy.body?.velocity?.y ?? 0;
            const playerVX = state.player.vx ?? 0;
            const playerVY = state.player.vy ?? 0;
            const radialVelocity = (enemyVX - playerVX) * nx + (enemyVY - playerVY) * ny;
            const dopplerFactor = Math.max(0.72, Math.min(1.38, 1 - radialVelocity * 0.0012));
            const shiftedFreq = (info.freq + proximity * 40) * dopplerFactor;
            const radialLabel = radialVelocity < -18 ? 'IN' : radialVelocity > 18 ? 'OUT' : 'LAT';
            const isClose  = dist < 400;
            const color    = !inRange ? 0x334433 : isClose ? 0xff6655 : 0x4dff88;
            const colorStr = !inRange ? '#334433' : isClose ? '#ff6655' : '#4dff88';
            const alpha    = inRange ? 0.85 : 0.30;

            const es = toScreen(enemy.x, enemy.y);
            if (es.x > -60 && es.x < W + 60 && es.y > -60 && es.y < H + 60) {
                g.lineStyle(1, color, inRange ? 0.55 : 0.18);
                g.strokeCircle(es.x, es.y, (enemy.radius ?? 10) + 5);
                const lx = es.x + (enemy.radius ?? 10) + 7;
                const ly = es.y - 7;
                makeLabel(colorStr, `${info.label} ${Math.round(shiftedFreq)} MHz ${radialLabel}`, lx, ly, alpha);
                if (inRange) strengthBar(lx, ly + 12, voiceStr, isClose ? 0xff6655 : 0x4dff88, alpha * 0.80);
                const cloakPhase = enemy.cloakPhase ?? 'cloaked';
                const aiState = cloakPhase === 'cloaked' ? 'CLOAK' :
                    cloakPhase === 'decloaking' ? 'DECLOAK..' :
                    cloakPhase === 'cloaking'   ? 'RECLOAK..' :
                    (enemy.combatState ?? 'DECLOAKED').toUpperCase();
                makeLabel('#888888', aiState, lx, ly + 22, 0.65);
            }

            if (inRange) specTick(shiftedFreq, isClose ? 0xff6655 : 0x4dff88);
            if (inRange && voiceStr > 0.005) {
                debugSignals.push({
                    label: info.label,
                    strength: voiceStr,
                    color: isClose ? 0xff6655 : 0x4dff88,
                    colorStr: isClose ? '#ff6655' : '#4dff88'
                });
            }
        }

        this.drawDebugSignalList(g, debugSignals, makeLabel, strengthBar, W);

        // Hide unused labels
        for (let i = labelIdx; i < this.debugLabels.length; i++) {
            this.debugLabels[i].setAlpha(0);
        }
    }

    drawDebugSignalList(g, signals, makeLabel, strengthBar, W) {
        const x = W - 188;
        const y = 84;
        const width = 168;
        const rowH = 14;
        const rows = signals
            .slice()
            .sort((a, b) => b.strength - a.strength)
            .slice(0, 9);
        const height = 26 + Math.max(1, rows.length) * rowH;

        g.fillStyle(0x020610, 0.78);
        g.fillRect(x - 8, y - 7, width, height);
        g.lineStyle(1, 0x7fffdf, 0.26);
        g.strokeRect(x - 8, y - 7, width, height);

        makeLabel('#7fffdf', 'SIGNALS', x, y, 0.88);

        if (rows.length === 0) {
            makeLabel('#334433', 'NONE', x, y + 17, 0.55);
            return;
        }

        for (let i = 0; i < rows.length; i++) {
            const signal = rows[i];
            const rowY = y + 17 + i * rowH;
            const pct = Math.round(Math.max(0, Math.min(1, signal.strength)) * 100).toString().padStart(3, ' ');
            makeLabel(signal.colorStr, `${signal.label.padEnd(8, ' ')} ${pct}%`, x, rowY, 0.82);
            strengthBar(x + 118, rowY + 3, signal.strength, signal.color, 0.78);
        }
    }

    sampleSpectrumBinsLog(data, nBins, sampleRate = 44100, fMin = 30, fMax = 3800) {
        const bins = new Array(nBins).fill(0);
        if (!data || data.length === 0) return bins;

        const hzPerBin = sampleRate / (data.length * 2);
        const logMin   = Math.log(fMin);
        const logMax   = Math.log(fMax);

        for (let i = 0; i < nBins; i++) {
            const freqLo = Math.exp(logMin + (i / nBins) * (logMax - logMin));
            const freqHi = Math.exp(logMin + ((i + 1) / nBins) * (logMax - logMin));
            const binLo  = Math.floor(freqLo / hzPerBin);
            const binHi  = Math.min(Math.max(binLo + 1, Math.ceil(freqHi / hzPerBin)), data.length);
            let peak = 0;
            for (let j = binLo; j < binHi; j++) peak = Math.max(peak, data[j] / 255);
            bins[i] = peak;
        }
        return bins;
    }
}
