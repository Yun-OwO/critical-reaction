import Phaser from 'phaser';
import { getVisualQuality, setVisualQuality, visualEffectsSummary, visualQualityLabel } from '../visual/quality';

type SettingsTab = '画面' | '声音' | '操作' | '游戏性';

export class SettingsScene extends Phaser.Scene {
  private tabs: SettingsTab[] = ['画面', '声音', '操作', '游戏性'];
  private tabIndex = 0;
  private tabText!: Phaser.GameObjects.Text;
  private contentText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;

  public constructor() {
    super('SettingsScene');
  }

  public create(): void {
    this.cameras.main.setBackgroundColor('#06111d');
    this.add.rectangle(960, 540, 792, 456, 0x0b1e2d, 0.96).setStrokeStyle(3, 0x24536d, 0.9);
    this.add.text(960, 365, '设置 / SETTINGS', { color: '#FFFFFF', fontFamily: 'monospace', fontSize: '40px' }).setOrigin(0.5);
    this.tabText = this.add.text(960, 425, '', { color: '#67E8F9', fontFamily: 'monospace', fontSize: '23px' }).setOrigin(0.5);
    this.contentText = this.add.text(960, 505, '', { color: '#D4E8EE', fontFamily: 'monospace', fontSize: '24px', align: 'center', lineSpacing: 20 }).setOrigin(0.5);
    this.statusText = this.add.text(960, 630, '设置已自动保存', { color: '#5CFFB1', fontFamily: 'monospace', fontSize: '18px' }).setOrigin(0.5);
    this.add.text(960, 740, '←/→ 切换标签　↑/↓ 调整　Esc 返回　Enter 确认', { color: '#91A8B8', fontFamily: 'monospace', fontSize: '18px' }).setOrigin(0.5);
    const backButton = this.add.text(960, 690, '返回主页　›', { color: '#FDE047', fontFamily: 'monospace', fontSize: '22px' }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backButton.on('pointerdown', () => this.leave());
    this.refresh();
    this.input.keyboard?.on('keydown-LEFT', () => { this.tabIndex = (this.tabIndex + this.tabs.length - 1) % this.tabs.length; this.refresh(); });
    this.input.keyboard?.on('keydown-RIGHT', () => { this.tabIndex = (this.tabIndex + 1) % this.tabs.length; this.refresh(); });
    this.input.keyboard?.on('keydown-UP', () => this.adjust(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.adjust(1));
    this.input.keyboard?.on('keydown-ESC', () => this.leave());
    this.input.keyboard?.on('keydown-ENTER', () => this.leave());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.removeAllListeners();
    });
  }

  private refresh(): void {
    this.tabText.setText(this.tabs.map((tab, index) => index === this.tabIndex ? `[ ${tab} ]` : `  ${tab}  `).join('　'));
    const tab = this.tabs[this.tabIndex];
    const content = tab === '画面'
      ? `光影质量　${visualQualityLabel(getVisualQuality())}\nBloom 光晕　${visualEffectsSummary().bloom ? '开启' : '降级'}\n动态光照　自动\n动态阴影　${visualEffectsSummary().shadows ? '开启' : '低质量关闭'}\n2.5D 深度　自动`
      : tab === '声音'
        ? '主音量　100%\n音效　开启\n环境音　开启\n冲刺反馈　增强'
        : tab === '操作'
          ? '移动　WASD / 虚拟摇杆\n攻击　左键 / 空格\n冲刺　鼠标右键\n切换状态　R'
          : '自动瞄准　视野内单位\n屏幕震动　中\n电子反馈　开启\n辅助提示　开启';
    this.contentText.setText(content);
  }

  private adjust(direction: number): void {
    if (this.tabs[this.tabIndex] === '画面') {
      const options = ['auto', 'low', 'medium', 'high'] as const;
      const current = options.indexOf(getVisualQuality());
      setVisualQuality(options[(current + direction + options.length) % options.length]);
      this.statusText.setText('设置已应用').setColor('#5CFFB1');
      this.refresh();
    }
  }

  private leave(): void {
    this.scene.start('LabScene');
  }
}
