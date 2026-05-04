import React from 'react';
import { profileTabs } from './profileContextModel';

export const ProfileNav = ({ lang = 'EN', activeTab, setActiveTab }) => (
  <div className="flex flex-wrap gap-2 mb-4">
    {profileTabs.map((tab) => (
      <button
        key={tab.key}
        onClick={() => setActiveTab(tab.key)}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${activeTab === tab.key ? 'bg-[#222] text-white border-[#333]' : 'bg-[#101014] text-slate-400 border-[#222] hover:text-white'}`}
      >
        {tab.label[lang === 'TR' ? 'TR' : 'EN']}
      </button>
    ))}
  </div>
);

export default ProfileNav;
