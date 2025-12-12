
import React from 'react';
import { Document } from '../../types';

interface DocumentTextViewModalProps {
  document: Document | null;
  onClose: () => void;
}

const DocumentTextViewModal: React.FC<DocumentTextViewModalProps> = ({ document, onClose }) => {
  if (!document) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
        className="fixed inset-0 bg-black bg-opacity-60 z-50 flex justify-center items-center p-4 animate-fade-in"
        onClick={handleBackdropClick}
    >
      <div 
        className="bg-white rounded-lg shadow-xl w-full max-w-3xl h-[80vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-title"
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-200 flex-shrink-0">
            <h2 id="document-title" className="text-xl font-bold text-brand-dark truncate pr-4" title={document.fileName}>
                {document.fileName}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full" aria-label="Close document view">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
        <div className="p-6 overflow-y-auto flex-grow">
            <pre className="text-sm text-gray-800 whitespace-pre-wrap font-sans">
                {document.extractedText || 'No text extracted from this document.'}
            </pre>
        </div>
         <div className="p-4 border-t border-gray-200 flex-shrink-0 text-right bg-gray-50 rounded-b-lg">
            <button 
                onClick={onClose} 
                className="px-4 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-primary transition-colors"
            >
                Close
            </button>
        </div>
      </div>
    </div>
  );
};

export default DocumentTextViewModal;