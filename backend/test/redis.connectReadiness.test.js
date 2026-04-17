describe('connectRedis readiness behavior', () => {
  it('does not return an open-but-not-ready client immediately', async () => {
    jest.resetModules();

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

    const { connectRedis } = require('../scripts/config/redis');

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
});
