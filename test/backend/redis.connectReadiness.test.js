describe('connectRedis readiness behavior', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.REDIS_TLS;
    delete process.env.REDIS_TLS_SKIP_VERIFY;
    delete process.env.NODE_ENV;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not return an open-but-not-ready client immediately', async () => {
    const handlers = new Map();
    const mockClient = {
      isReady: false,
      isOpen: false,
      connect: jest.fn(async () => {
        mockClient.isOpen = true;
      }),
      quit: jest.fn(async () => {
        mockClient.isOpen = false;
      }),
      on: jest.fn((event, fn) => {
        handlers.set(event, fn);
      }),
      off: jest.fn((event) => {
        handlers.delete(event);
      }),
      emit: (event, payload) => {
        const fn = handlers.get(event);
        if (fn) fn(payload);
      },
    };

    jest.doMock('redis', () => ({
      createClient: jest.fn(() => mockClient),
    }));

    const { connectRedis } = require('../../backend/scripts/config/redis');

    await connectRedis(); // first call sets client open, not ready

    let resolved = false;
    const second = connectRedis().then(() => {
      resolved = true;
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(resolved).toBe(false);

    mockClient.isReady = true;
    mockClient.emit('ready');

    await second;
    expect(resolved).toBe(true);
  });

  it('fails closed in production when REDIS_TLS_SKIP_VERIFY=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'rediss://cache.example:6379';
    process.env.REDIS_TLS_SKIP_VERIFY = 'true';

    jest.doMock('redis', () => ({
      createClient: jest.fn(() => ({ connect: jest.fn(), on: jest.fn() })),
    }));

    const { connectRedis } = require('../../backend/scripts/config/redis');
    await expect(connectRedis()).rejects.toThrow("REDIS_TLS_SKIP_VERIFY=true");
  });

  it('fails closed in production when REDIS_URL is missing', async () => {
    process.env.NODE_ENV = 'production';

    jest.doMock('redis', () => ({
      createClient: jest.fn(() => ({ connect: jest.fn(), on: jest.fn() })),
    }));

    const { connectRedis } = require('../../backend/scripts/config/redis');
    await expect(connectRedis()).rejects.toThrow("REDIS_URL zorunludur");
  });

  it('allows REDIS_TLS_SKIP_VERIFY=true in development', async () => {
    process.env.NODE_ENV = 'development';
    process.env.REDIS_URL = 'rediss://cache.example:6379';
    process.env.REDIS_TLS_SKIP_VERIFY = 'true';

    const createClient = jest.fn(() => ({
      isReady: true,
      isOpen: true,
      connect: jest.fn(async () => {}),
      on: jest.fn(),
    }));
    jest.doMock('redis', () => ({ createClient }));

    const { connectRedis } = require('../../backend/scripts/config/redis');
    await connectRedis();

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      url: 'rediss://cache.example:6379',
      socket: expect.objectContaining({ tls: true, rejectUnauthorized: false }),
    }));
  });

  it('enforces rejectUnauthorized=true for production rediss://', async () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'rediss://cache.example:6379';

    const createClient = jest.fn(() => ({
      isReady: true,
      isOpen: true,
      connect: jest.fn(async () => {}),
      on: jest.fn(),
    }));
    jest.doMock('redis', () => ({ createClient }));

    const { connectRedis } = require('../../backend/scripts/config/redis');
    await connectRedis();

    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      socket: expect.objectContaining({ tls: true, rejectUnauthorized: true }),
    }));
  });

  it('fails closed in production for non-TLS redis:// URL', async () => {
    process.env.NODE_ENV = 'production';
    process.env.REDIS_URL = 'redis://cache.example:6379';

    jest.doMock('redis', () => ({
      createClient: jest.fn(() => ({ connect: jest.fn(), on: jest.fn() })),
    }));

    const { connectRedis } = require('../../backend/scripts/config/redis');
    await expect(connectRedis()).rejects.toThrow("Production'da Redis TLS zorunludur");
  });
});
