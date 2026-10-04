export interface MobileInputState {
  /** 触屏控件是否已激活（出现过触摸即激活）。 */
  active: boolean;
  /** 虚拟摇杆方向，范围 -1..1，已归一化。 */
  moveX: number;
  moveY: number;
  /** 攻击按钮按住（自动连发）。 */
  attackHeld: boolean;
  /** 单次动作队列，由场景消费后复位。 */
  dashQueued: boolean;
  modeQueued: boolean;
  interactQueued: boolean;
  weaponSwitchQueued: boolean;
}

export const mobileInput: MobileInputState = {
  active: false,
  moveX: 0,
  moveY: 0,
  attackHeld: false,
  dashQueued: false,
  modeQueued: false,
  interactQueued: false,
  weaponSwitchQueued: false
};

export function resetQueuedActions(): void {
  mobileInput.dashQueued = false;
  mobileInput.modeQueued = false;
  mobileInput.interactQueued = false;
  mobileInput.weaponSwitchQueued = false;
}
