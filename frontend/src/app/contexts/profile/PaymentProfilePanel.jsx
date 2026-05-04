import React from 'react';

export const PaymentProfilePanel = ({ lang, payoutProfileDraft, setPayoutProfileDraft, handleUpdatePII }) => {
  const fields = payoutProfileDraft?.fields || {};
  return (
    <form onSubmit={handleUpdatePII} className="space-y-3 bg-[#101014] border border-[#222] rounded-xl p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <select value={payoutProfileDraft?.rail || 'TR_IBAN'} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, rail: e.target.value }))} className="bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm">
          <option value="TR_IBAN">TR_IBAN</option>
          <option value="SEPA_IBAN">SEPA_IBAN</option>
          <option value="US_ACH">US_ACH</option>
        </select>
        <input value={payoutProfileDraft?.country || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, country: e.target.value }))} placeholder="Country" className="bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
      </div>
      <input value={fields.account_holder_name || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, fields: { ...prev.fields, account_holder_name: e.target.value } }))} placeholder={lang === 'TR' ? 'Hesap Sahibinin Adı' : 'Account Holder Name'} className="w-full bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
      <input value={fields.iban || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, fields: { ...prev.fields, iban: e.target.value } }))} placeholder="IBAN" className="w-full bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
      <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-4 py-2 rounded-lg">{lang === 'TR' ? 'Kaydet' : 'Save'}</button>
    </form>
  );
};

export default PaymentProfilePanel;
