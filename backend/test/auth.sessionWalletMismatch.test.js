jest.mock('../scripts/services/siwe', () => ({
  verifyJWT: jest.fn(),
  isJWTBlacklisted: jest.fn(),
  revokeRefreshToken: jest.fn().mockResolvedValue(),
  blacklistJWT: jest.fn().mockResolvedValue(),
}));

const { revokeRefreshToken, blacklistJWT, verifyJWT } = require('../scripts/services/siwe');
const { requireSessionWalletMatch, requireAuth } = require('../scripts/middleware/auth');

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

  it('rejects jti-less auth cookie tokens as unsafe', async () => {
    verifyJWT.mockReturnValue({ sub: '0x1111111111111111111111111111111111111111', type: 'auth' });
    const req = { cookies: { araf_jwt: 'jwt-no-jti' } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
