import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { Camera, X, RefreshCw, AlertCircle } from "lucide-react";
import { useLang } from "../LangContext";

interface CameraBarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
  title?: string;
}

export function CameraBarcodeScanner({ open, onClose, onScan, title }: CameraBarcodeScannerProps) {
  const { t } = useLang();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    if (!open) {
      stopScan();
      return;
    }

    let isMounted = true;
    setErrorMsg(null);
    setIsLoading(true);

    const startScan = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Webcam / Camera API is not supported in this browser environment.");
        }

        const reader = new BrowserMultiFormatReader();
        readerRef.current = reader;

        // Obtain camera video stream
        const videoInputDevices = await BrowserMultiFormatReader.listVideoInputDevices();
        if (videoInputDevices.length === 0) {
          throw new Error("No video input devices / cameras found on this device.");
        }

        // Pick back camera if available (facingMode environment) or first device
        const selectedDevice = videoInputDevices.find(d => 
          d.label.toLowerCase().includes("back") || d.label.toLowerCase().includes("rear") || d.label.toLowerCase().includes("environment")
        ) || videoInputDevices[0];

        if (!isMounted) return;

        const controls = await reader.decodeFromVideoDevice(
          selectedDevice.deviceId,
          videoRef.current!,
          (result, err) => {
            if (result && isMounted) {
              const text = result.getText().trim();
              if (text) {
                stopScan();
                onScan(text);
                onClose();
              }
            }
          }
        );

        controlsRef.current = controls;
        if (isMounted) setIsLoading(false);
      } catch (err: any) {
        if (!isMounted) return;
        console.error("Camera scanner error:", err);
        setIsLoading(false);
        if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
          setErrorMsg("Camera permission was denied. Please allow camera access in your browser settings.");
        } else {
          setErrorMsg(err.message || "Failed to initialize camera scanner.");
        }
      }
    };

    startScan();

    return () => {
      isMounted = false;
      stopScan();
    };
  }, [open]);

  const stopScan = () => {
    try {
      if (controlsRef.current) {
        controlsRef.current.stop();
        controlsRef.current = null;
      }
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    } catch (_) {}
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden z-10 animate-pop-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Camera className="size-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm leading-tight text-foreground">
                {title || t.common?.scan || "Camera Barcode Scanner"}
              </h3>
              <p className="text-xs text-muted-foreground">Align barcode within the camera frame</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Camera Viewport Body */}
        <div className="relative bg-black min-h-[300px] flex items-center justify-center overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-white gap-3 z-20">
              <RefreshCw className="size-8 animate-spin text-primary" />
              <span className="text-xs font-semibold">Initializing camera feed…</span>
            </div>
          )}

          {errorMsg ? (
            <div className="p-6 text-center text-white space-y-3 z-20">
              <div className="size-12 rounded-full bg-destructive/20 text-destructive flex items-center justify-center mx-auto">
                <AlertCircle className="size-6" />
              </div>
              <h4 className="font-bold text-sm text-destructive">Camera Access Error</h4>
              <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">{errorMsg}</p>
              <button
                onClick={onClose}
                className="mt-2 px-4 py-2 bg-secondary text-secondary-foreground text-xs font-semibold rounded-lg hover:bg-secondary/80 transition-colors"
              >
                Close Scanner
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="w-full h-[320px] object-cover"
                playsInline
                muted
              />

              {/* Scanning Overlay Reticle */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-64 h-40 border-2 border-primary/80 rounded-xl relative shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                  {/* Target Crosshairs */}
                  <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary" />
                  <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary" />
                  <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary" />
                  <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary" />
                  
                  {/* Laser Beam Animation */}
                  <div className="w-full h-0.5 bg-red-500 shadow-[0_0_8px_#ef4444] absolute top-1/2 -translate-y-1/2 animate-pulse" />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-card border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>Supports 1D/2D Barcodes, EAN, Code 128, QR</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md border border-border text-foreground hover:bg-secondary transition-colors font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
