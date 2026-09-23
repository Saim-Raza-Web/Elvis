import { useState, useEffect } from 'react';

/**
 * PDA/Mobile Utilities
 * Provides fullscreen and Wake Lock support for PDA devices with graceful fallbacks
 */

export interface PDAScreenLockResult {
  success: boolean;
  error?: string;
}

/**
 * Request fullscreen mode with graceful fallback
 */
export async function requestFullscreen(): Promise<PDAScreenLockResult> {
  try {
    if (!document.documentElement.requestFullscreen) {
      return { 
        success: false, 
        error: 'Fullscreen API not supported in this browser' 
      };
    }

    await document.documentElement.requestFullscreen();
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Fullscreen request failed' 
    };
  }
}

/**
 * Exit fullscreen mode
 */
export async function exitFullscreen(): Promise<PDAScreenLockResult> {
  try {
    if (!document.exitFullscreen) {
      return { 
        success: false, 
        error: 'Fullscreen API not supported in this browser' 
      };
    }

    await document.exitFullscreen();
    return { success: true };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Fullscreen exit failed' 
    };
  }
}

/**
 * Check if currently in fullscreen mode
 */
export function isFullscreen(): boolean {
  return !!(
    document.fullscreenElement || 
    (document as any).webkitFullscreenElement || 
    (document as any).mozFullScreenElement || 
    (document as any).msFullscreenElement
  );
}

/**
 * Wake Lock API wrapper
 */
class WakeLockManager {
  private wakeLock: any = null;
  private listeners: Set<() => void> = new Set();

  /**
   * Request screen wake lock
   */
  async request(): Promise<PDAScreenLockResult> {
    try {
      if (!('wakeLock' in navigator)) {
        return { 
          success: false, 
          error: 'Wake Lock API not supported in this browser' 
        };
      }

      // @ts-ignore - Wake Lock API is experimental
      this.wakeLock = await navigator.wakeLock.request('screen');
      
      // Handle wake lock release
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
        this.notifyListeners();
      });

      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Wake Lock request failed' 
      };
    }
  }

  /**
   * Release screen wake lock
   */
  async release(): Promise<PDAScreenLockResult> {
    try {
      if (this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Wake Lock release failed' 
      };
    }
  }

  /**
   * Check if wake lock is active
   */
  isActive(): boolean {
    return this.wakeLock !== null;
  }

  /**
   * Add listener for wake lock state changes
   */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }
}

export const wakeLockManager = new WakeLockManager();

/**
 * React hook for PDA screen controls
 */
export function usePDAScreenControls() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isWakeLocked, setIsWakeLocked] = useState(false);
  const [capabilities, setCapabilities] = useState({
    fullscreenSupported: typeof document.documentElement.requestFullscreen === 'function',
    wakeLockSupported: 'wakeLock' in navigator
  });

  const toggleFullscreen = async () => {
    if (isFullscreen) {
      const result = await exitFullscreen();
      if (result.success) {
        setIsFullscreen(false);
      }
    } else {
      const result = await requestFullscreen();
      if (result.success) {
        setIsFullscreen(true);
      }
    }
  };

  const toggleWakeLock = async () => {
    if (isWakeLocked) {
      const result = await wakeLockManager.release();
      if (result.success) {
        setIsWakeLocked(false);
      }
    } else {
      const result = await wakeLockManager.request();
      if (result.success) {
        setIsWakeLocked(true);
      }
    }
  };

  // Update fullscreen state on change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(isFullscreen());
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, []);

  // Update wake lock state on change
  useEffect(() => {
    const unsubscribe = wakeLockManager.addListener(() => {
      setIsWakeLocked(wakeLockManager.isActive());
    });

    return unsubscribe;
  }, []);

  // Release wake lock on unmount
  useEffect(() => {
    return () => {
      wakeLockManager.release();
    };
  }, []);

  return {
    isFullscreen,
    isWakeLocked,
    capabilities,
    toggleFullscreen,
    toggleWakeLock,
    requestFullscreen,
    exitFullscreen
  };
}