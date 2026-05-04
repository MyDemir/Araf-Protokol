import React from 'react';

export const TechnicalDetailsDisclosure = ({ technicalDetails }) => {
  if (!technicalDetails) return null;
  return (
    <details className="mb-3 text-[11px] text-slate-500">
      <summary className="cursor-pointer">Technical details</summary>
      <pre className="mt-2 bg-[#101014] border border-[#222] rounded-lg p-2 overflow-auto">{JSON.stringify(technicalDetails, null, 2)}</pre>
    </details>
  );
};

export default TechnicalDetailsDisclosure;
