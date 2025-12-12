

import { createClient } from '@supabase/supabase-js';

const SUPABASE_PROJECT_URL = 'https://ujngwgyztrifpeuxnoov.supabase.co';

// IMPORTANT: For actual production deployments, this key MUST come from process.env for security.
// It is hardcoded here for the current interactive environment to ensure the the app loads
// and to explicitly use the correct key provided by the user matching the project URL.
export const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVqbmd3Z3l6dHJpZnBldXhub292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ3NjA1MjIsImV4cCI6MjA4MDMzNjUyMn0.S40JCq3XAjVdFE4-SToLkh-klV-wmxzmxpny7jLBkvQ';

if (!supabaseAnonKey) {
  throw new Error('Supabase Anon Key is not set. Please provide a valid key.');
}

export const supabase = createClient(SUPABASE_PROJECT_URL, supabaseAnonKey);