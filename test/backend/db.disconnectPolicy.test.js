const db = require('../../backend/scripts/config/db');

describe('db disconnect policy', () => {
  it('exports graceful shutdown toggle', () => {
    expect(typeof db.setAllowProcessExitOnDisconnect).toBe('function');
  });
});
