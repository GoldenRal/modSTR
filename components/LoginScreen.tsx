import React, { useState } from 'react';
import { supabase } from '../supabaseClient'; // Import supabase

interface LoginScreenProps {
  onLogin: (email: string, password: string, rememberMe: boolean) => void; // Update prop signature
  onGoToSignUp: () => void; // New prop to switch to signup screen
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onGoToSignUp }) => {
  const [email, setEmail] = useState(''); // Start with empty email
  const [password, setPassword] = useState(''); // Start with empty password
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberMe, setRememberMe] = useState(true); // New state for "Remember me" checkbox, default to true

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    // Call the onLogin prop which now expects email, password, and rememberMe
    onLogin(email, password, rememberMe);
    setLoading(false);
    // The App.tsx onAuthStateChange listener will handle UI state change upon successful login
    // and display a toast for success/failure via App.tsx's toast state.
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-primary">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl p-8 space-y-8">
        <div className="text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-auto text-brand-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.789-2.75 9.565C10.25 20.789 11 21 12 21c4.418 0 8-3.134 8-7s-3.582-7-8-7-8 3.134-8 7c0 1.861.657 3.583 1.75 4.948L4.25 16.947M12 11V3m0 8c-4.418 0-8 3.134-8 7" />
            </svg>
            <h2 className="mt-6 text-3xl font-extrabold text-brand-dark">
                LegalAI Title Analyzer
            </h2>
            <p className="mt-2 text-sm text-gray-600">
                Sign in to your account
            </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email-address" className="sr-only">Email address</label>
              <input
                id="email-address"
                name="email"
                type="email"
                autoComplete="email"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary focus:z-10 sm:text-sm"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary focus:z-10 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <input
                id="rememberMe"
                name="rememberMe"
                type="checkbox"
                className="h-4 w-4 text-brand-secondary focus:ring-brand-secondary border-gray-300 rounded"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                disabled={loading}
              />
              <label htmlFor="rememberMe" className="ml-2 block text-sm text-gray-900">
                Remember me
              </label>
            </div>
          </div>

          {error && (
            <p className="mt-2 text-sm text-red-600 text-center">{error}</p>
          )}
          <div>
            <button
              type="submit"
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-brand-secondary hover:bg-brand-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-secondary transition-colors duration-200"
              disabled={loading}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>

          <div className="text-center text-sm mt-6">
            <p>
              Don't have an account?{' '}
              <button
                type="button"
                onClick={onGoToSignUp}
                className="font-medium text-brand-secondary hover:text-brand-primary focus:outline-none focus:underline"
                disabled={loading}
              >
                Sign Up
              </button>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default LoginScreen;