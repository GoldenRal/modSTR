import React from 'react';
import { User } from '../../types'; // Removed Plan and ApiLimits imports

interface HeaderProps {
  user: User;
  onLogout: () => void;
  // Removed userPlan?: Plan | null;
  // Removed userApiLimits?: ApiLimits | null;
}

const Header: React.FC<HeaderProps> = ({ user, onLogout }) => {
  return (
    <header className="bg-brand-primary shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-brand-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span className="ml-3 text-xl font-bold text-white">LegalAI Title Analyzer</span>
          </div>
          <div className="flex items-center">
            <div className="text-right mr-4">
              <p className="text-sm font-medium text-white">{user.name}</p>
              <p className="text-xs text-indigo-200">{user.firmName}</p>
            </div>
            <button
              onClick={onLogout}
              className="p-2 rounded-full text-indigo-200 hover:text-white hover:bg-brand-secondary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-brand-primary focus:ring-white"
            >
                <span className="sr-only">Logout</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;