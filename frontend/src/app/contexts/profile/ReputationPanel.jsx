import React from 'react';

export const ReputationPanel = ({ userReputation }) => (
  <div className="bg-[#101014] border border-[#222] rounded-xl p-4 text-sm space-y-1">
    <p>Tier: <span className="text-emerald-400">{userReputation?.effectiveTier ?? 0}</span></p>
    <p>Successful: {userReputation?.successful ?? 0}</p>
    <p>Failed: {userReputation?.failed ?? 0}</p>
  </div>
);

export default ReputationPanel;
