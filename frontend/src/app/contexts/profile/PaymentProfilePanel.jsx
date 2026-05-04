import React from 'react';

export const PaymentProfilePanel = ({ lang, payoutProfileDraft, setPayoutProfileDraft, handleUpdatePII }) => {
  const fields = payoutProfileDraft?.fields || {};
  const selectedRail = payoutProfileDraft?.rail || 'TR_IBAN';

  const updateField = (key, value) => {
    setPayoutProfileDraft((prev) => ({
      ...prev,
      fields: {
        ...(prev?.fields || {}),
        [key]: value,
      },
    }));
  };

  return (
    <form onSubmit={handleUpdatePII} className="space-y-3 bg-[#101014] border border-[#222] rounded-xl p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <select value={selectedRail} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, rail: e.target.value }))} className="bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm">
          <option value="TR_IBAN">TR_IBAN</option>
          <option value="SEPA_IBAN">SEPA_IBAN</option>
          <option value="US_ACH">US_ACH</option>
        </select>
        <input value={payoutProfileDraft?.country || ''} onChange={(e) => setPayoutProfileDraft((prev) => ({ ...prev, country: e.target.value }))} placeholder="Country" className="bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
      </div>
      <input value={fields.account_holder_name || ''} onChange={(e) => updateField('account_holder_name', e.target.value)} placeholder={lang === 'TR' ? 'Hesap Sahibinin Adı' : 'Account Holder Name'} className="w-full bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
      {(selectedRail === 'TR_IBAN' || selectedRail === 'SEPA_IBAN') && (
        <input value={fields.iban || ''} onChange={(e) => updateField('iban', e.target.value)} placeholder="IBAN" className="w-full bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
      )}
      {selectedRail === 'SEPA_IBAN' && (
        <input value={fields.bic || ''} onChange={(e) => updateField('bic', e.target.value)} placeholder="BIC / SWIFT" className="w-full bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
      )}
      {selectedRail === 'US_ACH' && (
        <>
          <input value={fields.routing_number || ''} onChange={(e) => updateField('routing_number', e.target.value)} placeholder="Routing Number" className="w-full bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
          <input value={fields.account_number || ''} onChange={(e) => updateField('account_number', e.target.value)} placeholder="Account Number" className="w-full bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
          <input value={fields.account_type || ''} onChange={(e) => updateField('account_type', e.target.value)} placeholder="Account Type" className="w-full bg-[#151518] border border-[#2a2a2e] rounded-lg px-3 py-2 text-sm" />
        </>
      )}
      <button type="submit" className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-4 py-2 rounded-lg">{lang === 'TR' ? 'Kaydet' : 'Save'}</button>
    </form>
  );
};

export default PaymentProfilePanel;
