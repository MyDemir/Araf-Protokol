import { describe, it, expect } from 'vitest';
import { encodeEventTopics, encodeAbiParameters, parseAbi, getAddress } from 'viem';
import { extractOrderFilledArgs } from '../../frontend/src/hooks/useArafContract';

const abi = parseAbi([
  'event OrderFilled(uint256 indexed orderId, uint256 indexed tradeId, address indexed filler, uint256 fillAmount, uint256 remainingAmount, uint8 paymentRiskLevelSnapshot, bytes32 childListingRef)',
]);

const escrow = getAddress('0x00000000000000000000000000000000000000AA');
const other = getAddress('0x00000000000000000000000000000000000000BB');

function makeOrderFilledLog({ address = escrow, orderId = 1n, tradeId = 10n } = {}) {
  const topics = encodeEventTopics({ abi, eventName: 'OrderFilled', args: { orderId, tradeId, filler: other } });
  const data = encodeAbiParameters(
    [
      { type: 'uint256', name: 'fillAmount' },
      { type: 'uint256', name: 'remainingAmount' },
      { type: 'uint8', name: 'paymentRiskLevelSnapshot' },
      { type: 'bytes32', name: 'childListingRef' },
    ],
    [100n, 0n, 1, '0x' + '11'.repeat(32)],
  );
  return { address, topics, data };
}

describe('extractOrderFilledArgs strict filtering', () => {
  it('ignores OrderFilled logs from non-escrow address', () => {
    const receipt = { logs: [makeOrderFilledLog({ address: other, orderId: 9n, tradeId: 99n })] };
    const result = extractOrderFilledArgs(receipt, 9n, escrow);
    expect(result).toBeNull();
  });

  it('ignores escrow OrderFilled logs with different orderId', () => {
    const receipt = { logs: [makeOrderFilledLog({ address: escrow, orderId: 7n, tradeId: 42n })] };
    const result = extractOrderFilledArgs(receipt, 8n, escrow);
    expect(result).toBeNull();
  });

  it('returns tradeId only for escrow address with matching orderId', () => {
    const receipt = {
      logs: [
        makeOrderFilledLog({ address: other, orderId: 1n, tradeId: 999n }),
        makeOrderFilledLog({ address: escrow, orderId: 1n, tradeId: 1234n }),
      ],
    };
    const result = extractOrderFilledArgs(receipt, 1n, escrow);
    expect(result).not.toBeNull();
    expect(result.tradeId).toBe(1234n);
  });

  it('preserves OrderFilled tradeId values above Number.MAX_SAFE_INTEGER as bigint', () => {
    const unsafeTradeId = 900719925474099312345n;
    const receipt = { logs: [makeOrderFilledLog({ address: escrow, orderId: 55n, tradeId: unsafeTradeId })] };

    const result = extractOrderFilledArgs(receipt, 55n, escrow);

    expect(result).not.toBeNull();
    expect(result.tradeId).toBe(unsafeTradeId);
    expect(result.tradeId.toString()).toBe('900719925474099312345');
  });

  it('handles malformed logs safely without throwing', () => {
    const receipt = {
      logs: [
        { address: escrow, topics: ['0x1234'], data: '0x00' },
        makeOrderFilledLog({ address: escrow, orderId: 12n, tradeId: 1200n }),
      ],
    };

    expect(() => extractOrderFilledArgs(receipt, 12n, escrow)).not.toThrow();
    expect(extractOrderFilledArgs(receipt, 12n, escrow)?.tradeId).toBe(1200n);
  });
});
