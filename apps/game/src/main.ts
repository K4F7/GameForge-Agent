import Phaser from "phaser";

class BootScene extends Phaser.Scene {
  constructor() {
    super("boot");
  }

  create(): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, height / 2 - 36, "GameForge Agent", {
        color: "#f8fafc",
        fontFamily: "system-ui, sans-serif",
        fontSize: "42px",
        fontStyle: "bold",
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, height / 2 + 28, "CodeArts + TypeScript + Phaser", {
        color: "#38bdf8",
        fontFamily: "system-ui, sans-serif",
        fontSize: "20px",
      })
      .setOrigin(0.5);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: 960,
  height: 540,
  backgroundColor: "#111827",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene],
});
