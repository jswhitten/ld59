// EnergySystem
// Single unified power system for weapons, pulse charging, and shields.
//
// While Space is held (isCharging = true):
//   - Main energy still receives passive recharge every frame
//   - Main energy transfers into the scanner capacitor after passive recharge
// On Space release:
//   - Caller reads releaseCharge() to get accumulated charge (0–100) and fire the pulse
//
// Main energy always recharges at the same passive rate.
// Shields recharge separately, and repair faster while the main pool is full.
// Shots draw a fixed cost from the main pool. If the pool is too low, shots are blocked.

export class EnergySystem {
    constructor() {
        this.max          = 100;
        this.current      = 100;
        this.rechargeRate = 10;   // % of max per second — passive ambient recharge
        // transferRate > rechargeRate so holding space depletes the main pool even while it's
        // recharging — makes pulse charging feel like a real energy commitment.
        this.transferRate = 20;   // % of max per second — pool → capacitor while charging
        this.shotCost     = 8;
        this.lowThreshold = 20;

        this.shieldMax = 100;
        this.shield = 100;
        this.shieldRechargeRate = 6;
        this.shieldRechargeFullEnergyRate = 18;

        this.capMax    = 100;
        this.capCharge = 0;
        this.isCharging = false;   // set by GameScene each frame based on key state
    }

    update(delta) {
        const dt = delta / 1000;

        this.rechargeMainEnergy(dt);
        this.rechargeShields(dt);

        if (this.isCharging) {
            // Drain main pool into capacitor
            if (this.capCharge < this.capMax) {
                const transfer = Math.min(this.transferRate * dt, this.current, this.capMax - this.capCharge);
                this.current  -= transfer;
                this.capCharge += transfer;
            }
        }
    }

    rechargeMainEnergy(dt) {
        this.current = Math.min(this.max, this.current + this.rechargeRate * dt);
    }

    rechargeShields(dt) {
        if (this.shield < this.shieldMax) {
            const rate = this.current >= this.max ? this.shieldRechargeFullEnergyRate : this.shieldRechargeRate;
            this.shield = Math.min(this.shieldMax, this.shield + rate * dt);
        }
    }

    canShoot() { return this.current >= this.shotCost; }

    consumeShot() {
        if (!this.canShoot()) return false;
        this.current -= this.shotCost;
        return true;
    }

    absorbShieldDamage(amount) {
        if (this.shield <= 0) return amount;
        const absorbed = Math.min(this.shield, amount);
        this.shield -= absorbed;
        return amount - absorbed;
    }

    // Returns the accumulated capacitor charge (0–100) and resets it.
    // Call this on Space release; pass the result / 100 to Pulse as chargeLevel.
    releaseCharge() {
        const charge = this.capCharge;
        this.capCharge = 0;
        return charge;
    }

    get fraction()    { return this.current / this.max; }
    get capFraction() { return this.capCharge / this.capMax; }
    get shieldFraction() { return this.shield / this.shieldMax; }
    get isLow()       { return this.current < this.lowThreshold; }
}
