import React from 'react';

export const ScenarioShell = ({ title, description, children }) => (
  <section className="w-full bg-[#060608] border border-borderSubtle rounded-xl p-3 md:p-5" data-testid="ui-lab-scenario-shell">
    <div className="mb-4">
      <p className="text-xs font-bold uppercase tracking-wide text-brand">Scenario Preview / UI Lab</p>
      <h2 className="mt-1 text-xl font-bold text-textPrimary">{title}</h2>
      {description && <p className="mt-1 text-sm text-textSecondary">{description}</p>}
    </div>
    {children}
  </section>
);

export default ScenarioShell;
