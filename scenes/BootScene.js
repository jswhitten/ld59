// BootScene
// Preloads assets and transitions into the menu.
// For now there are no assets — all visuals are procedural.
// Audio assets will be added here as they're introduced.

export class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
    }

    preload() {
        // Asset loading would go here
    }

    create() {
        this.scene.start('MenuScene');
    }
}
