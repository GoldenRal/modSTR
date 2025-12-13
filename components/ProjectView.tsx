import React, { useState, useRef, useEffect } from 'react';
import mammoth from 'mammoth'; // Import mammoth.js
import { jsPDF } from 'jspdf'; // Import jsPDF
import 'jspdf-autotable'; // Import jspdf-autotable plugin
import { Project, Document, Report, User } from '../types';
import { generateReport, extractTextFromFile, UNSUPPORTED_FOR_EXTRACTION, RATE_LIMIT_EXCEEDED } from '../services/geminiService'; 
import { SCENARIOS, SCENARIO_BASED_DOCUMENTS, REPORT_FORMATS } from '../constants'; // Import REPORT_FORMATS
import Card from './ui/Card';
import Spinner from './ui/Spinner';
import DocumentTextViewModal from './ui/DocumentTextViewModal'; 
import Toast from './ui/Toast';

interface ProjectViewProps {
  project: Project;
  user: User;
  onUpdateProject: (updatedProject: Project) => void;
  onUploadDocuments: (projectId: string, files: File[]) => void;
  onDeleteDocument: (projectId: string, documentId: string) => void;
  onUpdateDocumentType: (projectId: string, documentId: string, newType: string) => void;
  onBack: () => void;
  // Add new props for project detail extraction
  onTriggerProjectDetailExtraction: (projectId: string) => void;
  isExtractingProjectDetails: boolean;
  checkApiAllowance: (apiType: string, value?: number) => Promise<boolean>; // New prop for API allowance check, now returns Promise<boolean>
}

// Updated props to include project details for the PDF header
const ReportSummaryCard: React.FC<{ report: Report; projectName: string; propertyAddress: string; clientName: string }> = ({ report, projectName, propertyAddress, clientName }) => {
    const [isDownloading, setIsDownloading] = useState(false);

    // A simplified markdown renderer for the summary
    const renderSummary = (text: string = "") => {
        return text
            .split('\n')
            .map((line, index) => {
                if (line.startsWith('### ')) {
                    return <h4 key={index} className="text-md font-bold text-brand-secondary mt-3 mb-1">{line.substring(4)}</h4>;
                }
                if (line.trim() === '') {
                    return null;
                }
                return <p key={index} className="text-sm text-gray-700 leading-relaxed mb-2">{line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</p>;
            })
            .filter(Boolean);
    };

    const handleDownloadSummaryPdf = () => {
        setIsDownloading(true);
        try {
            const doc = new jsPDF();
            const pageWidth = doc.internal.pageSize.getWidth();
            const margin = 15;
            let y = 20;

            // Header
            doc.setFontSize(18);
            doc.setTextColor(26, 35, 126); // Brand Primary
            doc.text("Executive Legal Summary", pageWidth / 2, y, { align: "center" });
            y += 10;

            // Project Info Box
            doc.setDrawColor(200, 200, 200);
            doc.setFillColor(245, 247, 250);
            doc.rect(margin, y, pageWidth - (margin * 2), 35, 'FD');
            
            doc.setFontSize(10);
            doc.setTextColor(80, 80, 80);
            doc.text(`Project: ${projectName}`, margin + 5, y + 8);
            doc.text(`Client: ${clientName}`, margin + 5, y + 16);
            
            const splitAddress = doc.splitTextToSize(`Address: ${propertyAddress}`, pageWidth - (margin * 2) - 10);
            doc.text(splitAddress, margin + 5, y + 24);
            
            y += 45;

            // Vital Stats (Category & Risk)
            doc.setFontSize(12);
            doc.setTextColor(0, 0, 0);
            doc.setFont("helvetica", "bold");
            doc.text("Vital Statistics", margin, y);
            y += 8;

            const categoryColor = report.strCategory?.includes("Clear") ? [0, 128, 0] : [200, 0, 0];
            doc.setTextColor(categoryColor[0], categoryColor[1], categoryColor[2]);
            doc.text(`Title Category: ${report.strCategory || 'N/A'}`, margin, y);
            y += 8;

            doc.setTextColor(0, 0, 0);
            doc.text(`Risk Factors Detected: ${report.riskFlags?.length || 0}`, margin, y);
            y += 15;

            // Summary Content
            doc.setFontSize(12);
            doc.text("Executive Analysis", margin, y);
            doc.setLineWidth(0.5);
            doc.line(margin, y + 2, pageWidth - margin, y + 2);
            y += 10;

            doc.setFont("helvetica", "normal");
            doc.setFontSize(10);
            const summaryText = report.summary?.replace(/\*\*/g, '') || "No summary generated.";
            const splitSummary = doc.splitTextToSize(summaryText, pageWidth - (margin * 2));
            doc.text(splitSummary, margin, y);
            
            y += splitSummary.length * 5 + 10;

            // Risk Flags Section
            if (report.riskFlags && report.riskFlags.length > 0) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(12);
                doc.setTextColor(185, 28, 28); // Red
                doc.text("Compliance Red Flags", margin, y);
                doc.setLineWidth(0.5);
                doc.setDrawColor(185, 28, 28);
                doc.line(margin, y + 2, pageWidth - margin, y + 2);
                y += 10;

                doc.setFont("helvetica", "normal");
                doc.setFontSize(10);
                doc.setTextColor(0, 0, 0);
                
                report.riskFlags.forEach(flag => {
                    const flagText = `• ${flag}`;
                    const splitFlag = doc.splitTextToSize(flagText, pageWidth - (margin * 2));
                    // Check page break
                    if (y + (splitFlag.length * 5) > doc.internal.pageSize.getHeight() - margin) {
                        doc.addPage();
                        y = 20;
                    }
                    doc.text(splitFlag, margin, y);
                    y += splitFlag.length * 5 + 2;
                });
            }

            // Footer
            const pageHeight = doc.internal.pageSize.getHeight();
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(`Generated by LegalAI Title Analyzer on ${new Date().toLocaleDateString()}`, margin, pageHeight - 10);

            doc.save(`${projectName.replace(/\s+/g, '_')}_Executive_Summary.pdf`);

        } catch (e) {
            console.error("Error generating summary PDF", e);
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <Card className="border-t-4 border-brand-secondary">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h3 className="text-2xl font-bold text-brand-dark">Executive Analysis & Summary</h3>
                    <p className="text-xs text-gray-500 mt-1">Generated on {new Date(report.generatedAt).toLocaleDateString()} at {new Date(report.generatedAt).toLocaleTimeString()}</p>
                </div>
                <button 
                    onClick={handleDownloadSummaryPdf}
                    disabled={isDownloading}
                    className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded transition-colors"
                >
                    {isDownloading ? <Spinner size="sm" /> : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    )}
                    <span>Download PDF</span>
                </button>
            </div>

            <div className="flex flex-col lg:flex-row gap-8">
                {/* Left Column: Vital Stats & Risks */}
                <div className="w-full lg:w-1/3 space-y-6">
                    {/* Vital Stats Box */}
                    <div className="bg-brand-light/30 p-4 rounded-lg border border-brand-primary/10">
                        <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Project Vitals</h4>
                        
                        <div className="mb-4">
                            <span className="text-xs text-gray-500 block">Overall Title Status</span>
                            <div className={`text-lg font-bold ${report.strCategory?.includes('Clear') ? 'text-green-700' : 'text-amber-600'}`}>
                                {report.strCategory || 'Analysis Pending'}
                            </div>
                        </div>

                        <div className="mb-2">
                            <span className="text-xs text-gray-500 block">Risk Factor Count</span>
                            <div className={`text-2xl font-extrabold ${report.riskFlags && report.riskFlags.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {report.riskFlags ? report.riskFlags.length : 0}
                            </div>
                        </div>
                    </div>

                    {/* Risk Flags List */}
                    <div>
                         <h4 className="text-lg font-bold text-gray-800 mb-3 flex items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-600 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M8.257 3.099c.636-1.21 2.27-1.21 2.906 0l4.257 8.122c.624 1.192-.26 2.653-1.583 2.653H5.583c-1.323 0-2.207-1.461-1.583-2.653l4.257-8.122zM10 12a1 1 0 110-2 1 1 0 010 2zm-1-4a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z" clipRule="evenodd" />
                            </svg>
                            Key Risk Indicators
                         </h4>
                         {(!report.riskFlags || report.riskFlags.length === 0) ? (
                            <div className="flex items-center text-green-700 bg-green-50 p-3 rounded-md border border-green-100">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                                <span className="text-sm font-medium">No critical red flags detected.</span>
                            </div>
                         ) : (
                            <ul className="space-y-2 bg-red-50 p-3 rounded-md border border-red-100">
                                {report.riskFlags.map((flag, index) => (
                                    <li key={index} className="flex items-start text-red-800">
                                        <span className="mr-2 text-red-500">•</span>
                                        <span className="text-sm font-medium leading-snug">{flag}</span>
                                    </li>
                                ))}
                            </ul>
                         )}
                    </div>
                </div>

                {/* Right Column: Narrative Summary */}
                <div className="w-full lg:w-2/3">
                    <h4 className="text-lg font-bold text-gray-800 mb-3 border-b pb-2">Executive Summary</h4>
                    <div className="bg-gray-50 p-5 rounded-lg border border-gray-200 text-gray-800">
                        {report.summary ? (
                            <div className="prose prose-sm prose-blue max-w-none">
                                {renderSummary(report.summary)}
                            </div>
                        ) : (
                            <p className="text-gray-500 italic">No narrative summary generated for this report.</p>
                        )}
                    </div>
                </div>
            </div>
        </Card>
    );
};

// Helper function to convert Markdown to Word-compatible HTML
const generateWordHtmlFromMarkdown = (markdown: string): string => {
    const lines = markdown.split('\n');
    const htmlLines: string[] = [];
    let inTable = false;
    let inList = false;
    let listType: 'ol' | 'ul' | null = null;

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Handle Numbered Lists
        const isListItem = /^\d+\.\s+/.test(trimmedLine);
        if (isListItem) {
            if (!inList || listType !== 'ol') {
                if (inList) htmlLines.push(`</${listType}>`);
                htmlLines.push('<ol style="margin-left: 20px;">');
                inList = true;
                listType = 'ol';
            }
            const liContent = trimmedLine.replace(/^\d+\.\s+/, '');
            const formattedLi = liContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            htmlLines.push(`<li>${formattedLi}</li>`);
            continue;
        }
        // Handle Unordered Lists
        const isUnorderedListItem = /^-+\s+/.test(trimmedLine);
        if (isUnorderedListItem) {
            if (!inList || listType !== 'ul') {
                if (inList) htmlLines.push(`</${listType}>`);
                htmlLines.push('<ul style="margin-left: 20px;">');
                inList = true;
                listType = 'ul';
            }
            const liContent = trimmedLine.replace(/^-+\s+/, '');
            const formattedLi = liContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            htmlLines.push(`<li>${formattedLi}</li>`);
            continue;
        }

        if (inList) {
            htmlLines.push(`</${listType}>`);
            inList = false;
            listType = null;
        }

        // Handle Tables (Standard Markdown syntax: | ... |)
        if (trimmedLine.startsWith('|')) {
            if (!inTable) {
                htmlLines.push('<table style="border-collapse: collapse; width: 100%; border: 1px solid black; margin-bottom: 1em;">');
                inTable = true;
            }
            // Check if it's a separator line like |---|---|
            if (trimmedLine.match(/^\|(?:\s*:?-+:?\s*\|)+$/)) {
                // Ignore separator line in HTML generation, browser/word handles borders via CSS
                continue;
            }
            
            const cells = trimmedLine.split('|').filter(c => c !== '').map(c => c.trim());
            
            // Determine if header row (naive check: if it's the first row of the table logic, but here we just render all as rows)
            // A better way is to rely on simple <tr><td> structure for Word compatibility
            htmlLines.push('<tr>');
            cells.forEach(cell => {
                const content = cell.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                htmlLines.push(`<td style="border: 1px solid black; padding: 5px;">${content}</td>`);
            });
            htmlLines.push('</tr>');
            continue;
        }
        if (inTable) {
            htmlLines.push('</table>');
            inTable = false;
        }

        // Handle Headings
        if (trimmedLine.startsWith('## ')) {
            htmlLines.push(`<h2 style="margin-top: 1em; margin-bottom: 0.5em; color: #2E74B5;">${trimmedLine.substring(3).replace(/\*\*/g, '')}</h2>`);
            continue;
        }
        if (trimmedLine.startsWith('### ')) {
            htmlLines.push(`<h3 style="margin-top: 1em; margin-bottom: 0.5em; color: #2E74B5;">${trimmedLine.substring(4).replace(/\*\*/g, '')}</h3>`);
            continue;
        }
        // Handle bold lines that look like headers (PART X, etc.)
        if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
             htmlLines.push(`<p style="margin-top: 1em; margin-bottom: 0.5em;"><strong>${trimmedLine.replace(/\*\*/g, '')}</strong></p>`);
             continue;
        }

        if (trimmedLine === '---') {
            htmlLines.push('<hr/>');
            continue;
        }

        if (trimmedLine === '') {
            htmlLines.push('<br/>');
            continue;
        }
        
        // Regular paragraphs
        const pLine = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        htmlLines.push(`<p>${pLine}</p>`);
    }
    
    if (inTable) htmlLines.push('</table>');
    if (inList) htmlLines.push(`</${listType}>`);

    return htmlLines.join('\n');
};


const ReportDisplay: React.FC<{ reportContent: string }> = ({ reportContent }) => {
    // Render Markdown to HTML for on-screen display using the same generator but ensuring it looks good in browser
    const htmlContent = generateWordHtmlFromMarkdown(reportContent || ''); 
    return (
        <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: htmlContent }} />
    );
};


// jsPDF-based Markdown Renderer for PDF
const renderMarkdownContentToPdf = (doc: jsPDF, markdownContent: string, user: User, isReformat: boolean = false, titlePrefix: string = '') => {
    let y = 15; // Initial Y position, will be updated
    const margin = 15;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - 2 * margin;

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0); // Black text

    const addPageIfNeeded = (requiredHeight: number) => {
        if (y + requiredHeight > pageHeight - margin) {
            doc.addPage();
            y = margin; // Reset Y for new page
        }
    };

    const lines = markdownContent.split('\n');
    let inTable = false;
    let tableHeaders: string[] = [];
    let tableBody: string[][] = [];

    // Helper to print text with auto line breaks
    const printText = (text: string, fontSize: number, fontStyle: 'normal' | 'bold' = 'normal', color = [0, 0, 0], align: 'left' | 'center' = 'left') => {
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', fontStyle);
        doc.setTextColor(color[0], color[1], color[2]);
        
        const splitText = doc.splitTextToSize(text, contentWidth);
        const lineHeight = fontSize / doc.internal.scaleFactor * 1.15; // Estimate line height
        
        addPageIfNeeded(splitText.length * lineHeight);
        
        for (const line of splitText) {
            let xPos = margin;
            if (align === 'center') {
                xPos = pageWidth / 2;
            }
            doc.text(line, xPos, y, { align: align });
            y += lineHeight;
        }
        y += fontSize * 0.2; // Small extra spacing
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        // Handle Tables with jspdf-autotable
        if (trimmedLine.startsWith('|')) {
            if (!inTable) {
                // Start of a table
                inTable = true;
                tableHeaders = [];
                tableBody = [];

                // Parse header
                const headerLine = trimmedLine;
                tableHeaders = headerLine.split('|').filter(c => c.trim() !== '').map(h => h.trim().replace(/\*\*(.*?)\*\*/g, '$1'));
                
                // Skip separator line (|---|---|)
                i++; 
                if (i < lines.length && lines[i].trim().match(/^\|(?:\s*:?-+:?\s*\|)+$/)) {
                   // Correctly detected separator, skipping it.
                } else {
                   // No separator found, rollback index to process this line as body (unlikely for valid markdown tables but good safety)
                   i--;
                }
                continue; 
            }

            // Parse body rows
            const bodyCells = trimmedLine.split('|').filter(c => c.trim() !== '').map(c => c.trim().replace(/\*\*(.*?)\*\*/g, '$1'));
            if (bodyCells.length > 0) {
                 tableBody.push(bodyCells);
            }
            
            // Check if next line is NOT a table line, to trigger render
            if (i + 1 >= lines.length || !lines[i + 1].trim().startsWith('|')) {
                 // Render Table
                addPageIfNeeded(20 + tableBody.length * 10);
                (doc as any).autoTable({
                    startY: y,
                    head: [tableHeaders],
                    body: tableBody,
                    styles: {
                        fontSize: 9,
                        cellPadding: 2,
                        lineColor: [180, 180, 180],
                        lineWidth: 0.1,
                        valign: 'top',
                    },
                    headStyles: {
                        fillColor: [240, 240, 240],
                        textColor: [0, 0, 0],
                        fontStyle: 'bold',
                        halign: 'left',
                    },
                    margin: { left: margin, right: margin },
                });
                y = (doc as any).lastAutoTable.finalY + 5; 
                inTable = false;
            }
            continue;
        }

        // Handle ## Main Title headings
        if (trimmedLine.startsWith('## ')) {
            addPageIfNeeded(20);
            printText(trimmedLine.substring(3).replace(/\*\*/g, ''), 16, 'bold', [0, 0, 0], 'center');
            y += 5; 
            continue;
        }
        // Handle ### Sub headings
         if (trimmedLine.startsWith('### ')) {
            addPageIfNeeded(15);
            printText(trimmedLine.substring(4).replace(/\*\*/g, ''), 14, 'bold', [44, 62, 80]);
            y += 3; 
            continue;
        }

        // Handle PART headings 
        if (trimmedLine.startsWith('**PART') || trimmedLine.match(/^\d+\]\s/) || trimmedLine.match(/^[IVX]+\.\s/)) {
            addPageIfNeeded(15);
            printText(trimmedLine.replace(/\*\*/g, ''), 12, 'bold');
            doc.setLineWidth(0.5);
            doc.line(margin, y - 2, pageWidth - margin, y - 2); 
            y += 5; 
            continue;
        }
       
        // Handle list items
        if (/^\d+\.\s+/.test(trimmedLine) || /^-+\s+/.test(trimmedLine)) {
            const listItemText = trimmedLine.replace(/^\d+\.\s+/, '').replace(/^-+\s+/, '');
            printText(`• ${listItemText.replace(/\*\*(.*?)\*\*/g, '$1')}`, 10);
            y -= 2; 
            continue;
        }

        // Handle simple text
        if (trimmedLine !== '') {
            const processedLine = line.replace(/\*\*(.*?)\*\*/g, '$1');
            printText(processedLine, 11);
        } else {
             y += 4;
        }
    }
    
    // Ensure Signature block is at the bottom or on a new page if too close
    addPageIfNeeded(30);
    doc.text(`Adv. ${user.name}`, pageWidth - margin, pageHeight - margin - 10, { align: 'right' });
};


const CompletenessChecklist: React.FC<{ 
    project: Project; 
    requiredDocTypes: string[]; 
    onTriggerUpload: () => void;
    onUpdateDocumentType: (docId: string, newType: string) => void;
}> = ({ project, requiredDocTypes, onTriggerUpload, onUpdateDocumentType }) => {
    
    const availableFiles = project.documents.filter(d => d.status !== 'Uploading' && d.status !== 'Error');

    return (
        <Card>
            <h3 className="text-xl font-bold text-brand-dark mb-4">Document Completeness</h3>
            <ul className="space-y-4">
                {requiredDocTypes.map(type => {
                    // Check if any document has this type in its docTypes array
                    const matchingDocs = project.documents.filter(doc => doc.docTypes?.includes(type));
                    const isFound = matchingDocs.length > 0;
                    const isMissing = project.missingDocuments?.includes(type);

                    return (
                        <li key={type} className="flex flex-col sm:flex-row sm:items-start justify-between bg-gray-50 p-3 rounded-md">
                            <div className="flex flex-col mb-2 sm:mb-0 flex-grow pr-2">
                                <div className="flex items-center">
                                    {isFound ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-500 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                        </svg>
                                    ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-500 mr-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                                          <path fillRule="evenodd" d="M8.257 3.099c.636-1.21 2.27-1.21 2.906 0l4.257 8.122c.624 1.192-.26 2.653-1.583 2.653H5.583c-1.323 0-2.207-1.461-1.583-2-653l4.257-8.122zM10 12a1 1 0 110-2 1 1 0 010 2zm-1-4a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z" clipRule="evenodd" />
                                        </svg>
                                    )}
                                    <span className={`text-sm font-medium ${isFound ? 'text-gray-900' : 'text-gray-700'}`}>{type}</span>
                                </div>
                                {isFound && (
                                    <div className="text-xs text-gray-500 ml-7 mt-1 break-all">
                                        Found in: {matchingDocs.map(d => d.fileName).join(', ')}
                                    </div>
                                )}
                            </div>
                            
                            <div className="flex items-center space-x-2 ml-7 sm:ml-0 flex-shrink-0">
                                <select
                                    className="text-xs border-gray-300 rounded shadow-sm focus:border-brand-secondary focus:ring-brand-secondary bg-white py-1 pl-2 pr-6 max-w-[160px]"
                                    onChange={(e) => {
                                        if(e.target.value) onUpdateDocumentType(e.target.value, type);
                                    }}
                                    value=""
                                    aria-label={`Map file to ${type}`}
                                >
                                    <option value="" disabled>{isFound ? 'Add Another File...' : 'Select File...'}</option>
                                    {availableFiles.map(file => (
                                        <option key={file.id} value={file.id}>
                                            {file.fileName}
                                        </option>
                                    ))}
                                </select>

                                {!isFound && (
                                    <button
                                        onClick={onTriggerUpload}
                                        className="text-xs font-semibold text-brand-secondary hover:text-brand-primary bg-brand-light px-2 py-1 rounded transition-colors whitespace-nowrap"
                                    >
                                        Upload
                                    </button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </Card>
    );
};


type SortKey = 'fileName' | 'uploadDate' | 'status' | 'docTypes';
type SortDirection = 'asc' | 'desc';

interface ToastState {
  show: boolean;
  message: string;
  type: 'info' | 'success' | 'error';
}

// Changed `ProjectView` from a default export to a named export.
export const ProjectView: React.FC<ProjectViewProps> = ({ project, user, onUpdateProject, onUploadDocuments, onDeleteDocument, onUpdateDocumentType, onBack, onTriggerProjectDetailExtraction, isExtractingProjectDetails, checkApiAllowance }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [isDownloadingPdfReport, setIsDownloadingPdfReport] = useState(false); // New state for PDF download
  const [sortKey, setSortKey] = useState<SortKey>('uploadDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [viewingDocument, setViewingDocument] = useState<Document | null>(null);
  const [toast, setToast] = useState<ToastState>({ show: false, message: '', type: 'info' });
  const [docTypeFilter, setDocTypeFilter] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    projectName: project.projectName,
    propertyAddress: project.propertyAddress,
    clientName: project.clientName,
    searchPeriod: project.searchPeriod,
    advocateInstructions: project.advocateInstructions || '', // Initialize with existing or empty string
  });

  // States for bank-specific report generation
  const [selectedReportFormat, setSelectedReportFormat] = useState<string>(REPORT_FORMATS[0]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const reportContentRef = useRef<HTMLDivElement>(null); // Ref for the report display div

  // Debugging log at the very start of rendering
  console.log("ProjectView: Initiating render for project:", project);

  // Defensive check for project validity
  if (!project || !project.id) {
    console.error("ProjectView: Received an invalid project object:", project);
    return (
        <div className="p-8 text-red-600 bg-red-100 rounded-lg">
            <h2 className="text-xl font-bold mb-2">Error Loading Project</h2>
            <p>Project data is missing or corrupted. Please return to the dashboard and try again.</p>
            <button 
                onClick={onBack} 
                className="mt-4 px-4 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-primary"
            >
                Back to Dashboard
            </button>
        </div>
    );
  }
  // End of defensive check

  useEffect(() => {
    if (!isEditing) {
      setFormData({
        projectName: project.projectName,
        propertyAddress: project.propertyAddress,
        clientName: project.clientName,
        searchPeriod: project.searchPeriod,
        advocateInstructions: project.advocateInstructions || '',
      });
    }
  }, [project, isEditing]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveDetails = () => {
    onUpdateProject({ ...project, ...formData });
    setIsEditing(false);
    setToast({ show: true, message: 'Project details updated!', type: 'success' });
  };

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    setToast({ show: true, message: 'Generating report...', type: 'info' });

    // NEW LIMITS FEATURE: Estimate tokens for report generation
    const allText = project.documents
          .filter(d => d.status === 'Processed' && d.extractedText)
          .map(d => `--- Document: ${d.fileName} ---\n${d.extractedText}`)
          .join('\n\n') || '';
    const estimatedInputTokens = Math.ceil(allText.length / 4) + 5000; // Base + template tokens
    const estimatedOutputTokens = 10000; // Expect a large output

    if (!(await checkApiAllowance('STR_GEN')) || !(await checkApiAllowance('TOKENS_INPUT', estimatedInputTokens)) || !(await checkApiAllowance('TOKENS_OUTPUT', estimatedOutputTokens))) {
      setIsGenerating(false);
      return;
    }

    try {
      const result = await generateReport(user.id, project, user, selectedReportFormat, estimatedInputTokens, estimatedOutputTokens, 'generateReport'); // Pass userId, estimated tokens
      
      if (result.error) {
        setToast({ show: true, message: `Report generation failed: ${result.error}`, type: 'error' });
      } else {
        onUpdateProject({ ...project, report: { 
          id: `report_${Date.now()}`,
          projectId: project.id,
          generatedAt: new Date().toISOString(),
          status: 'Finalized',
          content: result.content || '',
          strCategory: result.strCategory,
          summary: result.summary,
          riskFlags: result.riskFlags,
          ruleEngineFlags: {}, // Placeholder
          reportFormatUsed: selectedReportFormat,
        }});
        setToast({ show: true, message: 'Report generated successfully!', type: 'success' });
      }
    } catch (error) {
      console.error("Error during report generation:", error);
      setToast({ show: true, message: `An unexpected error occurred during report generation: ${error instanceof Error ? error.message : String(error)}`, type: 'error' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadReport = () => {
    if (!project.report?.content) {
      setToast({ show: true, message: 'No report content to download.', type: 'info' });
      return;
    }

    setIsDownloadingReport(true);
    try {
        const markdownContent = project.report.content;
        const htmlBody = generateWordHtmlFromMarkdown(markdownContent); 
        
        // Wrap in a standard HTML document structure with Word namespace for correct rendering
        const fullHtml = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head><meta charset='utf-8'><title>Report</title>
            <style>
              body { font-family: 'Times New Roman', serif; font-size: 12pt; }
              table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
              td, th { border: 1px solid black; padding: 5px; vertical-align: top; }
              h1, h2, h3, h4 { color: #2E74B5; }
              ul, ol { margin-left: 20px; }
            </style>
            </head><body>
            ${htmlBody}
            </body></html>
        `;

        const blob = new Blob([fullHtml], { type: 'application/msword' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.projectName.replace(/\s+/g, '_')}_Legal_Report.doc`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setToast({ show: true, message: 'Report download initiated!', type: 'success' });
    } catch (error) {
        console.error("Error generating Word document:", error);
        setToast({ show: true, message: `Failed to download Word report: ${error instanceof Error ? error.message : String(error)}`, type: 'error' });
    } finally {
        setIsDownloadingReport(false);
    }
  };

  const handleDownloadPdfReport = () => {
    const contentToPrint = project.report?.content; 
    
    if (!contentToPrint) {
      setToast({ show: true, message: 'No report content to download as PDF.', type: 'info' });
      return;
    }

    setIsDownloadingPdfReport(true);
    try {
      const doc = new jsPDF('p', 'mm', 'a4');
      const filename = `${project.projectName.replace(/\s+/g, '_')}_Legal_Report_PDF.pdf`;

      renderMarkdownContentToPdf(doc, contentToPrint, user, false, "Legal Scrutiny Report");
      doc.save(filename);
      setToast({ show: true, message: 'PDF report download initiated!', type: 'success' });
    } catch (error) {
      console.error("Error generating PDF report:", error);
      setToast({ show: true, message: `Failed to download PDF report: ${error instanceof Error ? error.message : String(error)}`, type: 'error' });
    } finally {
      setIsDownloadingPdfReport(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onUploadDocuments(project.id, Array.from(e.target.files));
      setToast({ show: true, message: `Uploading ${e.target.files.length} document(s)...`, type: 'info' });
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  const filteredDocuments = docTypeFilter
    ? project.documents.filter(doc => doc.docTypes?.includes(docTypeFilter))
    : project.documents;

  const sortedDocuments = [...filteredDocuments].sort((a, b) => {
    if (sortKey === 'fileName') {
      return sortDirection === 'asc' ? a.fileName.localeCompare(b.fileName) : b.fileName.localeCompare(a.fileName);
    }
    if (sortKey === 'uploadDate') {
      return sortDirection === 'asc'
        ? new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime()
        : new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime();
    }
    if (sortKey === 'status') {
        const statusOrder = ['Uploading', 'Uploaded', 'Extracting Text', 'Classifying', 'Processed', 'Error', 'Unsupported'];
        const statusA = statusOrder.indexOf(a.status);
        const statusB = statusOrder.indexOf(b.status);
        return sortDirection === 'asc' ? statusA - statusB : statusB - statusA;
    }
    if (sortKey === 'docTypes') {
        const typeA = (a.docTypes && a.docTypes.length > 0) ? a.docTypes[0] : '';
        const typeB = (b.docTypes && b.docTypes.length > 0) ? b.docTypes[0] : '';
        // Safely compare, handling empty arrays
        return sortDirection === 'asc' 
            ? typeA.localeCompare(typeB) 
            : typeB.localeCompare(typeA);
    }
    return 0;
  });

  const allDocTypes = Array.from(new Set(project.documents.flatMap(doc => doc.docTypes || [])));
  const requiredDocTypes = SCENARIO_BASED_DOCUMENTS[project.scenario || 'UNKNOWN'];


  return (
    <div className="relative p-6 bg-white rounded-lg shadow-md">
      <button onClick={onBack} className="absolute top-4 left-4 p-2 rounded-full bg-gray-200 hover:bg-gray-300 transition-colors" aria-label="Back to dashboard">
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
      </button>
      <div className="text-center mb-6">
        <h1 className="text-3xl font-bold text-brand-dark">{project.projectName}</h1>
        <p className="text-gray-600">{project.propertyAddress}</p>
      </div>

      {/* Project Details Card */}
      <Card className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-brand-dark">Project Details</h2>
          {isEditing ? (
            <button
              onClick={handleSaveDetails}
              className="px-4 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-primary transition-colors"
            >
              Save
            </button>
          ) : (
            <button
              onClick={() => setIsEditing(true)}
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-gray-700">
          <div>
            <label className="block text-sm font-medium text-gray-500">Project Name</label>
            {isEditing ? (
              <input type="text" name="projectName" value={formData.projectName} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" />
            ) : (
              <p className="mt-1 text-lg font-semibold">{project.projectName}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Property Address</label>
            {isEditing ? (
              <input type="text" name="propertyAddress" value={formData.propertyAddress} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" />
            ) : (
              <p className="mt-1 text-lg font-semibold">{project.propertyAddress}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Client Name</label>
            {isEditing ? (
              <input type="text" name="clientName" value={formData.clientName} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" />
            ) : (
              <p className="mt-1 text-lg font-semibold">{project.clientName}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Search Period</label>
            {isEditing ? (
              <input type="text" name="searchPeriod" value={formData.searchPeriod} onChange={handleInputChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm" />
            ) : (
              <p className="mt-1 text-lg font-semibold">{project.searchPeriod}</p>
            )}
          </div>
           <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-500">Advocate Instructions (Critical for AI)</label>
            {isEditing ? (
              <textarea name="advocateInstructions" value={formData.advocateInstructions} onChange={handleInputChange} rows={3} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm"></textarea>
            ) : (
              <p className="mt-1 text-lg font-semibold whitespace-pre-wrap">{project.advocateInstructions || 'No specific instructions.'}</p>
            )}
            <p className="mt-1 text-xs text-gray-500">Provide any critical, overriding instructions for AI report generation here (e.g., "Always use 'John Doe' as seller name").</p>
          </div>
        </div>
        <div className="mt-6">
            <label className="block text-sm font-medium text-gray-500">Identified Scenario</label>
            <p className="mt-1 text-lg font-semibold text-brand-secondary">{SCENARIOS[project.scenario || 'UNKNOWN'].name}</p>
            <p className="text-sm text-gray-500">{SCENARIOS[project.scenario || 'UNKNOWN'].description}</p>
            <button
              onClick={() => onTriggerProjectDetailExtraction(project.id)}
              disabled={isExtractingProjectDetails}
              className="mt-3 px-4 py-2 bg-brand-secondary text-white rounded-md hover:bg-brand-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              {isExtractingProjectDetails ? <Spinner size="sm" /> : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 inline-block mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                  </svg>
                  Re-extract Project Details
                </>
              )}
            </button>
        </div>
      </Card>

      {/* Document Completeness Checklist */}
      <CompletenessChecklist 
        project={project} 
        requiredDocTypes={requiredDocTypes} 
        onTriggerUpload={() => fileInputRef.current?.click()}
        onUpdateDocumentType={(docId, newType) => onUpdateDocumentType(project.id, docId, newType)}
      />

      {/* Documents List and Upload Section */}
      <Card className="mb-6 mt-6">
        <h2 className="text-xl font-bold text-brand-dark mb-4">Documents</h2>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 space-y-3 sm:space-y-0 sm:space-x-4">
          <div className="flex items-center space-x-2">
            <label htmlFor="docTypeFilter" className="text-sm font-medium text-gray-700 sr-only">Filter by Document Type:</label>
            <select
              id="docTypeFilter"
              value={docTypeFilter}
              onChange={(e) => setDocTypeFilter(e.target.value)}
              className="mt-1 block w-full md:w-auto pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary sm:text-sm rounded-md"
            >
              <option value="">All Document Types</option>
              {allDocTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            accept="image/*,.pdf,.csv,.docx"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-brand-secondary text-white font-bold rounded-lg shadow-sm hover:bg-brand-primary transition-colors flex items-center"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L6.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            Upload Documents
          </button>
        </div>

        {project.documents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No documents uploaded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => handleSort('fileName')}
                  >
                    File Name {sortKey === 'fileName' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => handleSort('docTypes')}
                  >
                    Doc Type(s) {sortKey === 'docTypes' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => handleSort('status')}
                  >
                    Status {sortKey === 'status' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                    onClick={() => handleSort('uploadDate')}
                  >
                    Upload Date {sortKey === 'uploadDate' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sortedDocuments.map((doc) => (
                  <tr key={doc.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 truncate max-w-xs" title={doc.fileName}>{doc.fileName}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {(doc.docTypes && doc.docTypes.length > 0) ? doc.docTypes.join(', ') : 'Unclassified'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        doc.status === 'Processed' ? 'bg-green-100 text-green-800' :
                        doc.status === 'Error' || doc.status === 'Unsupported' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {doc.status}
                      </span>
                      {doc.progress !== undefined && doc.progress < 100 && doc.status === 'Uploading' && (
                        <div className="w-full bg-gray-200 rounded-full h-1.5 mt-1">
                          <div className="bg-brand-secondary h-1.5 rounded-full" style={{ width: `${doc.progress}%` }}></div>
                        </div>
                      )}
                      {doc.error && <p className="text-xs text-red-500 mt-1">{doc.error}</p>}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{new Date(doc.uploadDate).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setViewingDocument(doc)}
                          className="text-brand-secondary hover:text-brand-primary"
                          title="View Extracted Text"
                          disabled={!doc.extractedText}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                        </button>
                        <button
                          onClick={() => onDeleteDocument(project.id, doc.id)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete Document"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      
      {/* Report Summary Card (conditional on project.report) */}
      {project.report && (
        <ReportSummaryCard 
            report={project.report} 
            projectName={project.projectName} 
            propertyAddress={project.propertyAddress} 
            clientName={project.clientName}
        />
      )}


      {/* Report Generation Controls */}
      <Card className="mb-6 mt-6">
        <h2 className="text-xl font-bold text-brand-dark mb-4">Generate Report</h2>
        <div className="flex flex-col md:flex-row items-stretch md:items-center space-y-4 md:space-y-0 md:space-x-4">
          <select
            value={selectedReportFormat}
            onChange={(e) => setSelectedReportFormat(e.target.value)}
            className="block w-full md:w-auto pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-brand-secondary focus:border-brand-secondary sm:text-sm rounded-md flex-grow"
          >
            {REPORT_FORMATS.map(format => (
              <option key={format} value={format}>{format}</option>
            ))}
          </select>
          <button
            onClick={handleGenerateReport}
            disabled={isGenerating || project.documents.filter(d => d.status === 'Processed').length === 0}
            className="px-6 py-2 bg-brand-secondary text-white font-bold rounded-lg shadow-sm hover:bg-brand-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center min-w-[150px]"
          >
            {isGenerating ? <Spinner size="sm" /> : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm4 6a1 1 0 100 2h3a1 1 0 100-2H8z" clipRule="evenodd" />
                </svg>
                Generate Report
              </>
            )}
          </button>
        </div>
        {project.documents.filter(d => d.status === 'Processed').length === 0 && (
            <p className="text-sm text-red-500 mt-2">Upload and process documents first to generate a report.</p>
        )}
      </Card>

      {/* Report Display */}
      {project.report?.content && (
        <Card className="mb-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold text-brand-dark">Generated Report ({project.report.reportFormatUsed})</h2>
            <div className="flex space-x-2">
                <button
                    onClick={handleDownloadPdfReport}
                    disabled={isDownloadingPdfReport}
                    className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                    {isDownloadingPdfReport ? <Spinner size="sm" /> : (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Download PDF
                        </>
                    )}
                </button>
                <button
                    onClick={handleDownloadReport}
                    disabled={isDownloadingReport}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                >
                    {isDownloadingReport ? <Spinner size="sm" /> : (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download DOC
                        </>
                    )}
                </button>
            </div>
          </div>
          <ReportDisplay reportContent={project.report.content || ''} />
        </Card>
      )}

      {/* Removed Re-format Existing Report Section as per user request */}
      
      <DocumentTextViewModal
        document={viewingDocument}
        onClose={() => setViewingDocument(null)}
      />

      {toast.show && (
        <Toast 
          message={toast.message} 
          type={toast.type} 
          onClose={() => setToast({ ...toast, show: false })} 
        />
      )}
    </div>
  );
};