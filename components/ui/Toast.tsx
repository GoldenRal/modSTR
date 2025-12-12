
import React, { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'info' | 'success' | 'error';
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    // Auto-close success and error toasts after 5 seconds
    if (type === 'success' || type === 'error') {
      const timer = setTimeout(() => {
        onClose();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [type, onClose]);

  const baseClasses = "fixed bottom-5 right-5 z-50 flex items-center p-4 rounded-lg shadow-lg text-white max-w-sm animate-fade-in-up";
  
  const typeStyles = {
    info: {
      bg: 'bg-brand-secondary',
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    },
    success: {
      bg: 'bg-green-500',
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    },
    error: {
      bg: 'bg-red-600',
      icon: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />,
    }
  };

  const styles = typeStyles[type];

  return (
    <div className={`${baseClasses} ${styles.bg}`} role="alert">
      <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        {styles.icon}
      </svg>
      <span className="flex-grow">{message}</span>
      <button onClick={onClose} className="ml-4 -mr-2 p-1.5 rounded-full hover:bg-white/20 transition-colors flex-shrink-0" aria-label="Close toast">
         <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>
  );
};

export default Toast;