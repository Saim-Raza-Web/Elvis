import React, { useRef } from 'react';
import Barcode from 'react-barcode';
import { Printer } from 'lucide-react';
import { PrimaryButton } from './AppShell';

interface BarcodeGeneratorProps {
  value: string;
  format?: 'CODE128' | 'EAN13' | 'UPC' | 'CODE39';
  title?: string;
}

export function BarcodeGenerator({ value, format = 'CODE128', title }: BarcodeGeneratorProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    if (!printRef.current) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Print Barcode - ${value}</title>
          <style>
            body { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; font-family: sans-serif; }
            .barcode-container { text-align: center; border: 1px dashed #ccc; padding: 20px; border-radius: 8px; }
            h2 { margin-bottom: 10px; font-size: 16px; }
          </style>
        </head>
        <body>
          <div class="barcode-container">
            ${title ? `<h2>${title}</h2>` : ''}
            ${printRef.current.innerHTML}
          </div>
          <script>
            window.onload = () => {
              window.print();
              window.close();
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="flex flex-col items-center gap-4 p-4 border border-border rounded-xl bg-card">
      <div ref={printRef} className="bg-white p-4 rounded-lg flex justify-center w-full overflow-hidden">
        <Barcode value={value} format={format} background="#ffffff" lineColor="#000000" displayValue={true} />
      </div>
      <PrimaryButton icon={Printer} onClick={handlePrint} className="w-full justify-center">
        Print Label
      </PrimaryButton>
    </div>
  );
}
