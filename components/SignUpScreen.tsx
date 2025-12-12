import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { Plan } from '../types';
import Spinner from './ui/Spinner';

interface SignUpScreenProps {
  onSignUp: (email: string, password: string, fullName: string, firmName: string, planId: number) => void;
  onGoToLogin: () => void;
}

const SignUpScreen: React.FC<SignUpScreenProps> = ({ onSignUp, onGoToLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [firmName, setFirmName] = useState('');
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // REMOVED: const [signUpSuccess, setSignUpSuccess] = useState(false); // New state for successful signup message

  useEffect(() => {
    const fetchPlans = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from('plans')
          .select('*')
          .order('id', { ascending: true });

        if (error) {
          throw error;
        }
        setAvailablePlans(data as Plan[]);
        if (data && data.length > 0) {
          setSelectedPlanId(data[0].id); // Select the first plan by default
        }
      } catch (err: any) {
        console.error('Error fetching plans:', err.message);
        setError(`Failed to load plans: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchPlans();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    // REMOVED: setSignUpSuccess(false); // Reset success state on new attempt

    if (!selectedPlanId) {
      setError('Please select a plan.');
      setLoading(false);
      return;
    }

    // Call the onSignUp prop, which now handles showing specific toasts and redirecting
    // based on Supabase's email confirmation flow.
    // The App.tsx `handleSignUp` now manages `setToast` and `setIsSignUpMode`.
    await onSignUp(email, password, fullName, firmName, selectedPlanId);
    setLoading(false);

    // After onSignUp, if no immediate error, we can assume App.tsx will handle toast
    // and potentially redirect to login screen if signup was successful or pending email confirmation.
    // We don't set local `signUpSuccess` here, it's handled by App.tsx's toast.
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-primary">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl p-8 space-y-8">
        <div className="text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-auto text-brand-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.789-2.75 9.565C10.25 20.789 11 21 12 21c4.418 0 8-3.134 8-7s-3.582-7-8-7-8 3.134-8 7c0 1.861.657 3.583 1.75 4.948L4.25 16.947M12 11V3m0 8c-4.418 0-8 3.134-8 7" />
          </svg>
          <h2 className="mt-6 text-3xl font-extrabold text-brand-dark">
            Create Your LegalAI Account
          </h2>
          <p className="mt-2 text-sm text-gray-600">
            Sign up to get started
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
                autoComplete="new-password"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary focus:z-10 sm:text-sm"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="full-name" className="sr-only">Full Name</label>
              <input
                id="full-name"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary focus:z-10 sm:text-sm"
                placeholder="Full Name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="firm-name" className="sr-only">Firm Name</label>
              <input
                id="firm-name"
                name="firmName"
                type="text"
                autoComplete="organization"
                required
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary focus:z-10 sm:text-sm"
                placeholder="Firm Name"
                value={firmName}
                onChange={(e) => setFirmName(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="plan-selection" className="block text-sm font-medium text-gray-700 mb-1">Select Your Plan:</label>
            {loading && !availablePlans.length ? (
                <div className="flex items-center justify-center py-2">
                    <Spinner size="sm" /> <span className="ml-2 text-sm text-gray-600">Loading plans...</span>
                </div>
            ) : (
                <select
                    id="plan-selection"
                    name="plan"
                    required
                    className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary sm:text-sm rounded-md"
                    value={selectedPlanId || ''}
                    onChange={(e) => setSelectedPlanId(Number(e.target.value))}
                    disabled={loading || !availablePlans.length}
                >
                    {availablePlans.map((plan) => (
                        <option key={plan.id} value={plan.id}>
                            {plan.name} (Monthly: ${plan.price_monthly})
                        </option>
                    ))}
                </select>
            )}
            {!availablePlans.length && !loading && (
                <p className="mt-2 text-sm text-red-600">No plans available. Please contact support.</p>
            )}
          </div>

          {error && (
            <p className="mt-2 text-sm text-red-600 text-center">{error}</p>
          )}
          <div>
            <button
              type="submit"
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-brand-secondary hover:bg-brand-primary focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-secondary transition-colors duration-200"
              disabled={loading || !selectedPlanId || !availablePlans.length}
            >
              {loading ? 'Signing up...' : 'Sign up'}
            </button>
          </div>

          <div className="text-center text-sm mt-6">
            <p>
              Already have an account?{' '}
              <button
                type="button"
                onClick={onGoToLogin}
                className="font-medium text-brand-secondary hover:text-brand-primary focus:outline-none focus:underline"
                disabled={loading}
              >
                Log in
              </button>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SignUpScreen;