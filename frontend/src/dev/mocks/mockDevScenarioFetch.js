const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

const buildMockBody = (url) => {
  const href = String(url || '');
  if (href.includes('trades/propose-cancel')) return { bothSigned: false, mocked: true };
  if (href.includes('chargeback-ack')) return { acknowledged: true, mocked: true };
  if (href.includes('settlement-proposals/preview')) return { available: false, mocked: true };
  return { mocked: true };
};

export const createMockDevScenarioFetch = () => async (url) => response(200, buildMockBody(url));
