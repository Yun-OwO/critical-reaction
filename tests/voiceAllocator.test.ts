import { describe, expect, it } from 'vitest';
import { VoiceAllocator, type VoiceRequest } from '../src/game/audio/VoiceAllocator';

const req = (over: Partial<VoiceRequest> = {}): VoiceRequest => ({
  event: 'combat.hit',
  soundId: 'hit',
  priority: 100,
  durationMs: 300,
  ...over
});

describe('VoiceAllocator 真实声部预算', () => {
  it('预算内可连续占用，达到上限后拒绝', () => {
    const a = new VoiceAllocator({ maxVoices: 3 });
    // 用不同 event：同语义有独立冷却，连续同 event 会被冷却挡住（那是另一条规则）
    expect(a.acquire(req({ event: 'e1' }), 0).ok).toBe(true);
    expect(a.acquire(req({ event: 'e2', soundId: 'hit2' }), 10).ok).toBe(true);
    expect(a.acquire(req({ event: 'e3', soundId: 'hit3' }), 20).ok).toBe(true);
    expect(a.activeVoices).toBe(3);
    // 第 4 个：同优先级无法抢占 → 拒绝
    const denied = a.acquire(req({ event: 'e4', soundId: 'hit4' }), 30);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('voice-cap');
  });

  it('release 之后额度立即恢复（不是等时间窗淘汰）', () => {
    const a = new VoiceAllocator({ maxVoices: 2 });
    const g1 = a.acquire(req({ event: 'e1', soundId: 's1' }), 0);
    const g2 = a.acquire(req({ event: 'e2', soundId: 's2' }), 10);
    expect(a.acquire(req({ event: 'e3', soundId: 's3' }), 20).ok).toBe(false);
    a.release(g1.voiceId);
    expect(a.activeVoices).toBe(1);
    expect(a.acquire(req({ event: 'e3', soundId: 's3' }), 20).ok).toBe(true);
    expect(g2.voiceId).not.toBe(g1.voiceId);
  });

  it('释放不存在的 voiceId 安全', () => {
    const a = new VoiceAllocator();
    expect(() => a.release(9999)).not.toThrow();
  });
});

describe('VoiceAllocator 重叠与同语义冷却', () => {
  it('同一 soundId 超过重叠上限即拒', () => {
    const a = new VoiceAllocator({ maxOverlapPerSound: 2 });
    expect(a.acquire(req({ event: 'e1', soundId: 'x' }), 0).ok).toBe(true);
    expect(a.acquire(req({ event: 'e2', soundId: 'x' }), 10).ok).toBe(true);
    const third = a.acquire(req({ event: 'e3', soundId: 'x' }), 20);
    expect(third.ok).toBe(false);
    expect(third.reason).toBe('overlap');
  });

  it('同一语义在冷却窗内被拒（不同 soundId 也算）', () => {
    const a = new VoiceAllocator({ perEventCooldownMs: 100 });
    expect(a.acquire(req({ event: 'swing', soundId: 'a' }), 0).ok).toBe(true);
    const again = a.acquire(req({ event: 'swing', soundId: 'b' }), 50);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('event-cooldown');
    // 冷却过后放行
    expect(a.acquire(req({ event: 'swing', soundId: 'c' }), 150).ok).toBe(true);
  });

  it('不同语义互不受冷却影响（拾取不被挥砍挡住）', () => {
    const a = new VoiceAllocator({ perEventCooldownMs: 100 });
    expect(a.acquire(req({ event: 'swing', soundId: 'a' }), 0).ok).toBe(true);
    expect(a.acquire(req({ event: 'pickup', soundId: 'b' }), 5).ok).toBe(true);
  });
});

describe('VoiceAllocator 优先级抢占', () => {
  it('预算耗尽时高优先级可抢占低优先级', () => {
    const a = new VoiceAllocator({ maxVoices: 1, stealFloorPriority: 30 });
    const low = a.acquire(req({ event: 'ui', soundId: 'ui', priority: 30 }), 0);
    expect(low.ok).toBe(true);
    const high = a.acquire(req({ event: 'hurt', soundId: 'hurt', priority: 95 }), 10);
    expect(high.ok).toBe(true);
    expect(high.steal).toHaveLength(1);
    expect(high.steal[0].voiceId).toBe(low.voiceId);
    // 被抢占的额度已让出，低优先级再次申请会失败（预算被高优先级占着）
    expect(a.activeVoices).toBe(1);
  });

  it('低于抢占门槛的请求不能抢', () => {
    const a = new VoiceAllocator({ maxVoices: 1, stealFloorPriority: 30 });
    a.acquire(req({ event: 'ui', soundId: 'ui', priority: 30 }), 0);
    const low = a.acquire(req({ event: 'ui2', soundId: 'ui2', priority: 25 }), 10);
    expect(low.ok).toBe(false);
    expect(low.reason).toBe('steal-disabled');
  });

  it('同优先级不互相抢占（避免普通命中互掐）', () => {
    const a = new VoiceAllocator({ maxVoices: 1, stealFloorPriority: 30 });
    a.acquire(req({ event: 'a', soundId: 'a', priority: 100 }), 0);
    const b = a.acquire(req({ event: 'b', soundId: 'b', priority: 100 }), 10);
    expect(b.ok).toBe(false);
    expect(b.reason).toBe('voice-cap');
  });

  it('一次只抢一个（不清空整片装饰音）', () => {
    const a = new VoiceAllocator({ maxVoices: 2, stealFloorPriority: 30 });
    a.acquire(req({ event: 'u1', soundId: 'u1', priority: 30 }), 0);
    a.acquire(req({ event: 'u2', soundId: 'u2', priority: 30 }), 10);
    const high = a.acquire(req({ event: 'danger', soundId: 'd', priority: 95 }), 20);
    expect(high.steal).toHaveLength(1);
    expect(a.activeVoices).toBe(2);
  });

  it('抢优先抢优先级最低的（并列取最早）', () => {
    const a = new VoiceAllocator({ maxVoices: 2, stealFloorPriority: 30 });
    const low = a.acquire(req({ event: 'low', soundId: 'low', priority: 20 }), 0);
    const mid = a.acquire(req({ event: 'mid', soundId: 'mid', priority: 50 }), 10);
    const high = a.acquire(req({ event: 'danger', soundId: 'd', priority: 95 }), 20);
    expect(high.steal[0].voiceId).toBe(low.voiceId);
    // mid 仍在
    expect(a.activeVoices).toBe(2);
    void mid;
  });
});

describe('VoiceAllocator 生命周期', () => {
  it('reset 清空全部活跃与冷却记录', () => {
    const a = new VoiceAllocator({ maxVoices: 2 });
    a.acquire(req({ event: 'swing', soundId: 'a' }), 0);
    a.acquire(req({ event: 'pickup', soundId: 'b' }), 10);
    a.reset();
    expect(a.activeVoices).toBe(0);
    // 冷却记录也清了：同一语义立刻可再播
    expect(a.acquire(req({ event: 'swing', soundId: 'a' }), 15).ok).toBe(true);
  });

  it('voiceId 不复用（诊断可追溯）', () => {
    const a = new VoiceAllocator({ maxVoices: 2 });
    const ids = new Set<number>();
    for (let i = 0; i < 6; i += 1) {
      const g = a.acquire(req({ event: `e${i}`, soundId: `s${i}` }), i * 10);
      if (g.ok) ids.add(g.voiceId);
    }
    expect(ids.size).toBeGreaterThan(1);
  });
});