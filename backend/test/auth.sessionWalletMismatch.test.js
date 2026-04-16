jest.mock('../scripts/services/siwe', () => ({
  verifyJWT: jest.fn(),
  isJWTBlacklisted: jest.fn(),
  revokeRefreshToken: jest.fn().mockResolvedValue(),
  blacklistJWT: jest.fn().mockResolvedValue(),
}));

const { revokeRefreshToken, blacklistJWT } = require('../scripts/services/siwe');
const { requireSessionWalletMatch } = require('../scripts/middleware/auth');

describe('requireSessionWalletMatch', () => {
  it('blacklists active JWT and revokes refresh family on wallet mismatch', async () => {
    const req = {
      headers: { 'x-wallet-address': '0x2222222222222222222222222222222222222222' },
      cookies: { araf_jwt: 'jwt-token' },
      wallet: '0x1111111111111111111111111111111111111111',
    };

    const res = {
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    const next = jest.fn();

    await requireSessionWalletMatch(req, res, next);

    expect(blacklistJWT).toHaveBeenCalledWith('jwt-token');
    expect(revokeRefreshToken).toHaveBeenCalledWith(req.wallet);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(next).not.toHaveBeenCalled();
  });
});
