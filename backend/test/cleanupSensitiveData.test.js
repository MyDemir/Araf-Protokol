jest.mock('../scripts/models/Trade', () => ({
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
}));

const Trade = require('../scripts/models/Trade');
const { runReceiptCleanup, runPIISnapshotCleanup } = require('../scripts/jobs/cleanupSensitiveData');

describe('cleanupSensitiveData terminal-state guards', () => {
  it('limits receipt cleanup to terminal trade states', async () => {
    await runReceiptCleanup(new Date('2026-01-01T00:00:00Z'));
    const [query] = Trade.updateMany.mock.calls[0];
    expect(query.status).toEqual({ $in: ['RESOLVED', 'CANCELED', 'BURNED'] });
  });

  it('limits payout snapshot cleanup to terminal trade states', async () => {
    await runPIISnapshotCleanup(new Date('2026-01-01T00:00:00Z'));
    const [query] = Trade.updateMany.mock.calls[1];
    expect(query.status).toEqual({ $in: ['RESOLVED', 'CANCELED', 'BURNED'] });
  });

  it('nulls additive lock-time reputation semantics fields during snapshot cleanup', async () => {
    await runPIISnapshotCleanup(new Date('2026-01-01T00:00:00Z'));
    const [, update] = Trade.updateMany.mock.calls[1];
    expect(update.$set).toMatchObject({
      'payout_snapshot.maker.reputation_context_at_lock.burn_count': null,
      'payout_snapshot.maker.reputation_context_at_lock.auto_release_count': null,
      'payout_snapshot.maker.reputation_context_at_lock.mutual_cancel_count': null,
      'payout_snapshot.maker.reputation_context_at_lock.disputed_resolved_count': null,
      'payout_snapshot.taker.reputation_context_at_lock.burn_count': null,
      'payout_snapshot.taker.reputation_context_at_lock.auto_release_count': null,
      'payout_snapshot.taker.reputation_context_at_lock.mutual_cancel_count': null,
      'payout_snapshot.taker.reputation_context_at_lock.disputed_resolved_count': null,
    });
  });
});
