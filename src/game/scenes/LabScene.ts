import Phaser from 'phaser';

export class LabScene extends Phaser.Scene {
  public constructor() {
    super('LabScene');
  }

  public create(): void {
    this.cameras.main.setBackgroundColor('#0A0E1A');
    this.input.keyboard?.once('keydown-ENTER', () => this.scene.start('GameScene'));
  }
}
